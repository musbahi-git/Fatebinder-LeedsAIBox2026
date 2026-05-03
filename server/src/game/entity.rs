use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Using entities for items and monsters. maybe hazards too.
//   This is to be called/spawned into fate events.

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EntityType {
	Enemy,
	Item,
	Hazard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
	pub id: Uuid,
	pub entity_type: EntityType,
	pub position: [f32; 3],
	pub health: u32,
}

impl Entity {
	pub fn new(entity_type: EntityType, position: [f32; 3]) -> Self {
		Self 
		{
			id: Uuid::new_v4(),
			entity_type,
			position, 
			health: 50,

		}
	}
}