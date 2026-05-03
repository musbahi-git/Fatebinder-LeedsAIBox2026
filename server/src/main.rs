mod game;
mod world;
mod server;

// Entry point, declares our modules and starts the async runtime

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
	// Intialize the logging tool
	tracing_subscriber::fmt::init();

	// Start the game server
	server::run().await
}
