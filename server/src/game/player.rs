// Defining a player str4uct so we can send it as json to the clients

use serde::{Serialize, Deserialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
	pub id: Uuid,
	pub name: String,
	pub position: [f32; 3]
	pub rotation: [f32; 2]
	pub health: u32,
	pub ore_count: u32,
}

impl Player {
	pub fn new(id: Uuid, name: String) -> Self {
		Self {
			id,
			name,
			position: [0.0, 32.0, 0.0],
			rotation: [0.0, 0.0],
			health: 100,
			ore_count: 0,
		}
	}
	pub fn take_damage(&mut self, amount:u32) {
		self.health = self.health.saturating_sub(amount);
	}
	pub fn heal(&mut self, amount:u32) {
		self.health = (self.health + amount).min(100);
	}
}