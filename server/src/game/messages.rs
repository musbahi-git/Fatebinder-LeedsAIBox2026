use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;
use super::player::Player;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMessage {
    Join { room_id: String, name: String },
    Move { position: [f32; 3], rotation: [f32; 2] },
    Mine { chunk_x: i32, chunk_y: i32, chunk_z: i32, x: usize, y: usize, z: usize },
    MoralChoice { question: String, answer: String },
    ResolvedMoralChoice {
        player_id: Uuid,
        title: String,
        effect: FateEffect,
        next_question: String,
        player_answer: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoralChoice {
    pub player_id: Uuid,
    pub question: String,
    pub answer: String,
    pub effect: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FateEffect {
    pub hp_delta: i32,
    pub ore_multiplier: f32,
    pub world_note: String,
    /// Category used by AI-driven fate resolution (e.g. "hp_gain", "ore_loss", "world_event")
    pub effect_type: String,
    /// Numeric magnitude for the effect category
    pub effect_amount: i32,
    /// AI-suggested choices for the next moral dilemma
    pub suggested_choices: Vec<String>,
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
    ChunkData { chunk: [i32; 3], voxels: Vec<u8> },
    ChunkDelta { chunk: [i32; 3], changes: Vec<[u8; 4]> },
    FatePrompt { question: String, choices: Vec<String> },
    FateResult { effect: String },
    ResolvedFate {
        player_id: Uuid,
        title: String,
        effect: FateEffect,
        next_question: Option<String>,
        player_answer: String,
    },
    Error(String),
}
