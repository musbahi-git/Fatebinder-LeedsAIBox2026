use serde::{Deserialize, Serialize};
use noise::{NoiseFn, Perlin};



// Cave generation using procedural voxel and perlin noise.
// higher density = more solid voxels
// cave networks created sequentially
// ore and gems have much rarer densities


#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Voxel {
	pub solid: bool,
	pub ore: bool,
	pub gem: bool,
}

impl Voxel {

// Defines voxel type and checks for voxel components (ore/gem)
	pub fn empty() -> Self {
		Self 
		{
			solid: false,
			ore: false,
			gem: false,
		}
	}

	pub fn wall() -> Self {
		Self
		{
			solid: true,
			ore: false,
			gem: false,
		}
	}

	pub fn ore() -> Self {
		Self
		{
			solid: true,
			ore: true,
			gem: false,
		}
	}

	pub fn gem() -> Self {
		Self
		{
			solid: true,
			ore: false,
			gem: true,
		}
	}
}
// defining chunk size

pub const CHUNK_SIZE: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
	pub x: i32,
	pub y: i32,
	pub z: i32,
	pub voxels: [[[Voxel; CHUNK_SIZE]; CHUNK_SIZE]; CHUNK_SIZE],

}

impl Chunk {
	pub fn generate(x: i32, y:i32, z:i32) -> Self {

	// FIXING THE SEED FOR WORLD GEN SO WE CAN REPEAT SPECIFIC PLAYTHRUS, MAY CHANGE FOR RELEASE
		let perlin = Perlin::new(42); 
		let mut voxels = [[[Voxel::empty(); CHUNK_SIZE]; CHUNK_SIZE]; CHUNK_SIZE];




		for lx in 0..CHUNK_SIZE {
			for ly in 0..CHUNK_SIZE {
				for lz in 0..CHUNK_SIZE {
					let world_x = (x as f64) * CHUNK_SIZE as f64 + lx as f64;
					let world_y = (y as f64) * CHUNK_SIZE as f64 + ly as f64;
					let world_z = (z as f64) * CHUNK_SIZE as f64 + lz as f64;




					let density = perlin.get([
						world_x / 32.0,
						world_y / 32.0,
						world_z / 32.0,
					]);

					voxels[lx][ly][lz] = if density > 0.3 {
						if density > 0.7 {
							if rand::random::<f64>() > 0.8 {
								Voxel::gem()
							} else {
								Voxel::ore()
							}
						} else {
							Voxel::wall()
						}
					} else {
						Voxel::empty()
					};
				}
			}
		}

		Self { x, y, z, voxels }
	}

	pub fn get_voxel(&self, x: usize, y: usize, z: usize) -> Option<Voxel> {
	if x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE {
		Some(self.voxels[x][y][z])
	} else {
		None
	}
}
pub fn set_voxel(&mut self, x: usize, y: usize, z: usize, voxel: Voxel) -> bool {
	if x < CHUNK_SIZE && y < CHUNK_SIZE && z < CHUNK_SIZE {
		self.voxels[x][y][z] = voxel;
		true
		} else {
		false
		}
	}
}

pub struct ChunkManager {
	chunks: std::collections::HashMap<(i32, i32, i32), Chunk>,
}

impl ChunkManager {
	pub fn new() -> Self {
		Self {
			chunks: std::collections::HashMap::new(),
		}
	}

	pub fn get_or_generate(&mut self, x: i32, y:i32, z: i32) -> &Chunk {
		
		self.chunks

			.entry((x, y, z))
			.or_insert_with(|| Chunk::generate(x,y,z))
	}

	pub fn get_mut(&mut self, x: i32, y: i32, z: i32) -> Option<&mut Chunk> {
	
				self.chunks.get_mut(&(x, y, z))
	
		}
}
