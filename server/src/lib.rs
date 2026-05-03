pub mod game;
pub mod world;
pub mod server;


// sets modules for public use, so we can use them in main.rs without the module prefix
pub use game::*;
pub use world::*;