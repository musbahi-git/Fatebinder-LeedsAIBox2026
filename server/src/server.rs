use anyhow::Result;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tracing::info;
use uuid::Uuid;

use crate::game::{ClientMessage, GameState, MoralChoice, ServerMessage, SharedGameState};

pub type ClientRegistry = Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>>>;

fn build_question(last: Option<String>) -> (String, Vec<String>) {
    if let Some(prev) = last {
        let q = format!(
            "A miner before you chose: '{}'. Do you follow this path or break the cycle?",
            prev
        );
        (
            q,
            vec![
                "Follow the path".to_string(),
                "Break the cycle".to_string(),
                "Walk away".to_string(),
            ],
        )
    } else {
        (
            "You find a trapped miner and a cache of ore. Do you save them or take the ore and leave?".to_string(),
            vec![
                "Save them".to_string(),
                "Take the ore".to_string(),
                "Split the risk".to_string(),
            ],
        )
    }
}

fn effect_from_answer(answer: &str) -> String {
    let lower = answer.to_lowercase();
    if lower.contains("save") || lower.contains("break") {
        "You chose mercy. Your health surges, but your ore haul is lighter.".to_string()
    } else if lower.contains("take") || lower.contains("follow") {
        "You chose ambition. Your ore rises, but the cave's weight drains your vitality.".to_string()
    } else {
        "You chose uncertainty. The tunnels stay silent, and fate remains unresolved.".to_string()
    }
}

pub async fn run() -> Result<()> {
    println!("\nThe Fatebinder Server starting...\n");

    let state: SharedGameState = Arc::new(RwLock::new(GameState::new()));
    let registry: ClientRegistry = Arc::new(RwLock::new(HashMap::new()));

    let ticker_state = state.clone();
    let ticker_registry = registry.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(33));
        loop {
            interval.tick().await;
            let mut state_lock = ticker_state.write().await;
            let registry_lock = ticker_registry.read().await;
            let active_rooms: Vec<String> = state_lock.rooms.keys().cloned().collect();

            for room in active_rooms {
                let snapshot = state_lock.snapshot_room(&room);
                let sync_msg = ServerMessage::StateSync(snapshot);

                if let Some(players) = state_lock.rooms.get(&room) {
                    for uuid in players {
                        if let Some(sender) = registry_lock.get(uuid) {
                            let _ = sender.send(sync_msg.clone());
                        }
                    }
                }
            }
        }
    });

    let addr = "0.0.0.0:4000";
    let listener = TcpListener::bind(&addr).await?;
    println!("Listening on: {}", addr);

    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let state_clone = state.clone();
            let registry_clone = registry.clone();
            tokio::spawn(handle_connection(stream, state_clone, registry_clone));
        }
    });

    tokio::signal::ctrl_c().await?;
    println!("\nThe Fatebinder Server is shutting down....\n");
    Ok(())
}

async fn handle_connection(stream: TcpStream, state: SharedGameState, registry: ClientRegistry) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let client_id = Uuid::new_v4();
    let mut current_room = String::new();

    while let Some(msg) = ws_receiver.next().await {
        if let Ok(Message::Text(text)) = msg {
            if let Ok(ClientMessage::Join { room_id, name }) = serde_json::from_str(&text) {
                let mut state_lock = state.write().await;
                let _player = state_lock.join_player(room_id.clone(), client_id, name);
                current_room = room_id;

                let welcome = ServerMessage::Welcome { id: client_id };
                let msg_str = serde_json::to_string(&welcome).unwrap();
                let _ = ws_sender.send(Message::Text(msg_str)).await;
                break;
            }
        }
    }

    if current_room.is_empty() { return; }

    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();
    {
        let mut reg_lock = registry.write().await;
        reg_lock.insert(client_id, tx);
    }

    let write_task = tokio::spawn(async move {
        while let Some(server_msg) = rx.recv().await {
            if let Ok(text) = serde_json::to_string(&server_msg) {
                if ws_sender.send(Message::Text(text)).await.is_err() { break; }
            }
        }
    });

    while let Some(Ok(msg)) = ws_receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                let mut state_lock = state.write().await;
                match client_msg {
                    ClientMessage::Move { position, rotation } => {
                        state_lock.move_player(client_id, position, rotation);
                    }
                    ClientMessage::Mine { chunk_x, chunk_y, chunk_z, x, y, z } => {
                        let got_ore = state_lock.mine(client_id, (chunk_x, chunk_y, chunk_z), x, y, z);
                        if got_ore {
                            println!("Player {} just found some ore!", client_id);

                            let ore_count = state_lock
                                .players
                                .get(&client_id)
                                .map(|p| p.ore_count)
                                .unwrap_or(0);

                            // Lightweight fate trigger: every 3 ore pickups opens a moral prompt.
                            if ore_count > 0 && ore_count % 3 == 0 {
                                let (question, choices) = build_question(state_lock.next_question_seed(&current_room));
                                info!(?client_id, ?current_room, ?question, "Fate trigger: sending FatePrompt");
                                state_lock.queue_fate_prompt(client_id, question.clone(), choices.clone());

                                let prompt = ServerMessage::FatePrompt {
                                    question: question.clone(),
                                    choices: choices.clone(),
                                };

                                if let Ok(reg_lock) = registry.try_read() {
                                    if let Some(sender) = reg_lock.get(&client_id) {
                                        info!(?client_id, ?current_room, ?question, "Sending FatePrompt to player");
                                        let _ = sender.send(prompt);
                                    }
                                }
                            }
                        }
                    }
                    ClientMessage::MoralChoice { question, answer } => {
                        // Backwards-compatible lightweight handling for simple choices
                        let effect_text = effect_from_answer(&answer);
                        info!(?client_id, ?current_room, ?question, ?answer, "MoralChoice (lightweight) received");
                        if let Some(player) = state_lock.players.get_mut(&client_id) {
                            let lower = answer.to_lowercase();
                            if lower.contains("save") || lower.contains("break") {
                                player.health = (player.health + 10).min(100);
                                player.ore_count = player.ore_count.saturating_sub(2);
                            } else if lower.contains("take") || lower.contains("follow") {
                                player.ore_count += 10;
                                player.health = player.health.saturating_sub(10);
                            }
                        }

                        state_lock.record_moral_choice(MoralChoice {
                            player_id: client_id,
                            question,
                            answer,
                            effect: effect_text.clone(),
                            timestamp: GameState::now_ts(),
                        });
                        state_lock.pending_fate_prompts.remove(&client_id);

                        let fate_result = ServerMessage::FateResult { effect: effect_text.clone() };
                        if let Ok(reg_lock) = registry.try_read() {
                            if let Some(room_players) = state_lock.rooms.get(&current_room) {
                                for uuid in room_players {
                                    if let Some(sender) = reg_lock.get(uuid) {
                                        let _ = sender.send(fate_result.clone());
                                    }
                                }
                            }
                        }
                    }
                    ClientMessage::ResolvedMoralChoice { player_id, title, effect, next_question, player_answer } => {
                        info!(
                            ?player_id,
                            ?current_room,
                            ?title,
                            answer = ?player_answer,
                            ?next_question,
                            "ResolvedMoralChoice received — applying effect and broadcasting FateResult"
                        );

                        // Apply named effect_type + amount from the AI response.
                        state_lock.apply_effect(player_id, &effect.effect_type, effect.effect_amount);

                        // Also apply the structured FateEffect (hp_delta, ore_multiplier) for
                        // backwards compatibility with the rest of the game logic.
                        if let Some(player) = state_lock.players.get_mut(&player_id) {
                            if effect.hp_delta < 0 {
                                player.health = player.health.saturating_sub((-effect.hp_delta) as u32);
                            } else {
                                player.health = (player.health + effect.hp_delta as u32).min(100);
                            }
                            let new_ore = ((player.ore_count as f32) * effect.ore_multiplier).round().max(0.0) as u32;
                            player.ore_count = new_ore;
                        }

                        // Record in moral history.
                        state_lock.record_moral_choice(MoralChoice {
                            player_id,
                            question: "(AI resolved)".to_string(),
                            answer: player_answer.clone(),
                            effect: effect.world_note.clone(),
                            timestamp: GameState::now_ts(),
                        });

                        // Store next question for future prompts (room-scoped).
                        state_lock.set_next_question(&current_room, next_question.clone());

                        state_lock.pending_fate_prompts.remove(&player_id);

                        // Broadcast FateResult to all in the same room.
                        let fate_result = ServerMessage::FateResult { effect: effect.world_note.clone() };
                        if let Ok(reg_lock) = registry.try_read() {
                            if let Some(room_players) = state_lock.rooms.get(&current_room) {
                                for uuid in room_players {
                                    if let Some(sender) = reg_lock.get(uuid) {
                                        let _ = sender.send(fate_result.clone());
                                    }
                                }
                            }
                        }

                        // Also broadcast ResolvedFate with the full AI response for clients
                        // that want to display title/next_question/suggested_choices.
                        let resolved = ServerMessage::ResolvedFate {
                            player_id,
                            title: title.clone(),
                            effect: effect.clone(),
                            next_question: Some(next_question.clone()),
                            player_answer: player_answer.clone(),
                        };
                        if let Ok(reg_lock) = registry.try_read() {
                            if let Some(room_players) = state_lock.rooms.get(&current_room) {
                                for uuid in room_players {
                                    if let Some(sender) = reg_lock.get(uuid) {
                                        let _ = sender.send(resolved.clone());
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    write_task.abort();
    {
        let mut reg_lock = registry.write().await;
        reg_lock.remove(&client_id);
    }
    {
        let mut state_lock = state.write().await;
        state_lock.remove_player(client_id);
    }
}
