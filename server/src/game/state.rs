use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::{player::Player, entity::Entity};
use crate::world::{ChunkManager, chunk::Voxel};
use super::messages::{StateSyncData, ChunkDelta, MoralChoice};

pub struct GameState {
    pub players: HashMap<Uuid, Player>,
    pub entities: HashMap<Uuid, Entity>,
    pub chunks: ChunkManager,
    pub player_rooms: HashMap<Uuid, String>,
    pub rooms: HashMap<String, Vec<Uuid>>,
    pub room_chunk_deltas: HashMap<String, Vec<ChunkDelta>>,
    pub moral_history: VecDeque<MoralChoice>,
    pub pending_fate_prompts: HashMap<Uuid, (String, Vec<String>)>,
    pub pending_next_question: HashMap<String, String>,
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
            moral_history: VecDeque::with_capacity(16),
            pending_fate_prompts: HashMap::new(),
            pending_next_question: HashMap::new(),
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

    pub fn queue_fate_prompt(&mut self, player_id: Uuid, question: String, choices: Vec<String>) {
        self.pending_fate_prompts.insert(player_id, (question, choices));
    }

    pub fn record_moral_choice(&mut self, choice: MoralChoice) {
        if self.moral_history.len() >= 16 {
            self.moral_history.pop_front();
        }
        self.moral_history.push_back(choice);
    }

    pub fn next_question_seed(&self, room: &str) -> Option<String> {
        self.pending_next_question.get(room).cloned()
    }

    /// Apply a named effect to a player (hp_gain, hp_loss, ore_gain, ore_loss, world_event).
    pub fn apply_effect(&mut self, player_id: Uuid, effect_type: &str, amount: i32) {
        let Some(player) = self.players.get_mut(&player_id) else { return };
        match effect_type {
            "hp_gain" => {
                player.health = (player.health + amount as u32).min(100);
                tracing::info!(?player_id, hp_gain = amount, "Player health increased");
            }
            "hp_loss" => {
                player.health = player.health.saturating_sub((-amount) as u32);
                tracing::info!(?player_id, hp_loss = amount, "Player health decreased");
            }
            "ore_gain" => {
                player.ore_count = player.ore_count.saturating_add(amount as u32);
                tracing::info!(?player_id, ore_gain = amount, "Player ore increased");
            }
            "ore_loss" => {
                player.ore_count = player.ore_count.saturating_sub((-amount) as u32);
                tracing::info!(?player_id, ore_loss = amount, "Player ore decreased");
            }
            "world_event" => {
                tracing::info!(?player_id, "World event triggered for player");
            }
            other => {
                tracing::warn!(?player_id, effect_type = other, "Unknown effect type");
            }
        }
    }

    pub fn set_next_question(&mut self, room: &str, question: String) {
        tracing::info!(room, ?question, "Setting pending next question for room");
        self.pending_next_question.insert(room.to_string(), question);
    }

    /// Returns the current unix timestamp in seconds.
    pub fn now_ts() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

pub type SharedGameState = Arc<RwLock<GameState>>;
