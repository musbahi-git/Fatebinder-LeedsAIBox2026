use anyhow::Result;

pub async fn run() -> Result<()> {
	println!("

The Fatebinder Server starting...

")


// TODO: Initialise game state
//start the socket.io listener



// to keep server running, Imma add the server logic later

tokio::signal::ctrl_c().await?;
println!("

The Fatebinder Server is shutting down....

");
Ok(())

}