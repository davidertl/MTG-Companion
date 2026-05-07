fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{}", mancutg_arenac::cli_usage());
        return;
    }

    if args.first().is_some_and(|arg| arg == "serve") {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime");
        if let Err(error) = runtime.block_on(mancutg_arenac::run_serve(&args[1..])) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    match mancutg_arenac::run_cli(&args) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
