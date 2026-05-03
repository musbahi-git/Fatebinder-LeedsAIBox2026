import os

messages = """use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;
use super::player::Player;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMessage {
    Join { room_id: String, name: String },
    Move { position: [f32; 3], rotation: [f32; 2] },
    Mine { chunk_x: i32, chunk_y: i32, chunk_z: i32, x: usize, y: usize, z: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSyncData {
    pub players: HashMap<Uuid, Player>,
    pub chunk_deltas: Vec<ChunkDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkDelta {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub chunk_z: i32,
    pub x: usize,
    pub y: usize,
    pub z: usize,
    pub solid: bool,
    pub ore: bool,
    pub gem: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerMessage {
    Welcome { id: Uuid },
    PlayerJoined(Player),
    PlayerLeft { id: Uuid },
    StateSync(StateSyncData),
    Error(String),
}
"""

state = """use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{player::Player, entity::Entity};
use crate::world::{ChunkManager, chunk::Voxel};
use super::messages::{StateSyncData, ChunkDelta};

pub struct GameState {
    pub players: HashMap<Uuid, Player>,
    pub entities: HashMap<Uuid, Entity>,
    pub chunks: ChunkManager,
    pub player_rooms: HashMap<Uuid, String>,
    pub rooms: HashMap<String, Vec<Uuid>>,
    pub room_chunk_deltas: HashMap<String, Vec<ChunkDelta>>,
}

impl GameState {
    pub fn new() -> Self {
        Self {
            players: HashMap::new(),
            entities: HashMap::new(),
            chunks: ChunkManager::new(),
            player_rooms: HashMap::new(),
            rooms: HashMap::new(),
            room_chunk_deltas: HashMap::new(),
        }
    }

    pub fn join_player(&mut self, room: String, id: Uuid, name: String) -> Player {
        let player = Player::new(id, name);
        self.players.insert(id, player.clone());
        self.player_rooms.insert(id, room.clone());
        self.rooms.entry(room).or_default().push(id);
        player
    }

    pub fn move_player(&mut self, id: Uuid, pos: [f32; 3], rot: [f32; 2]) {
        if let Some(player) = self.players.get_mut(&id) {
            player.position = pos;
            player.rotation = rot;
        }
    }

    pub fn mine(&mut self, player_id: Uuid, chunk_coords: (i32, i32, i32), vx: usize, vy: usize, vz: usize) -> bool {
        let (cx, cy, cz) = chunk_coords;
        let mut got_ore = false;

        let _ = self.chunks.get_or_generate(cx, cy, cz);
        
        if let Some(chunk) = self.chunks.get_mut(cx, cy, cz) {
            if let Some(voxel) = chunk.get_voxel(vx, vy, vz) {
                if voxel.solid {
                    got_ore = voxel.ore;
                    let empty_voxel = Voxel::empty();
                    let _ = chunk.set_voxel(vx, vy, vz, empty_voxel);
                    
                    if let Some(room) = self.player_rooms.get(&player_id) {
                        self.room_chunk_deltas.entry(room.clone()).or_default().push(ChunkDelta {
                            chunk_x: cx, chunk_y: cy, chunk_z: cz,
                            x: vx, y: vy, z: vz,
                            solid: false, ore: false, gem: false,
                        });
                    }
                }
            }
        }

        if got_ore {
            if let Some(player) = self.players.get_mut(&player_id) {
                player.ore_count += 1;
            }
        }
        got_ore
    }

    pub fn snapshot_room(&mut self, room: &str) -> StateSyncData {
        let mut room_players = HashMap::new();
        if let Some(player_ids) = self.rooms.get(room) {
            for id in player_ids {
                if let Some(player) = self.players.get(id) {
                    room_players.insert(*id, player.clone());
                }
            }
        }
        let chunk_deltas = self.room_chunk_deltas.remove(room).unwrap_or_default();
        StateSyncData { players: room_players, chunk_deltas }
    }

    pub fn remove_player(&mut self, id: Uuid) {
        self.players.remove(&id);
        if let Some(room) = self.player_rooms.remove(&id) {
            if let Some(room_players) = self.rooms.get_mut(&room) {
                room_players.retain(|&p_id| p_id != id);
            }
        }
    }
}

pub type SharedGameState = Arc<RwLock<GameState>>;
"""

server = """use anyhow::Result;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

use crate::game::{ClientMessage, GameState, Player, ServerMessage, SharedGameState, messages::StateSyncData};

pub type ClientRegistry = Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>>>;

pub async fn run() -> Result<()> {
    println!("\\nThe Fatebinder Server starting...\\n");

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

    let addr = "0.0.0.0:3000";
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
    println!("\\nThe Fatebinder Server is shutting down....\\n");
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
                        state_lock.mine(client_id, (chunk_x, chunk_y, chunk_z), x, y, z);
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
"""

def write(p, c):
    with open(p, "w", encoding="utf-8") as f:
        f.write(c)

write("src/game/messages.rs", messages)
write("src/game/state.rs", state)
write("src/server.rs", server)
