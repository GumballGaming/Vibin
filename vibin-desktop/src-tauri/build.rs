use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../frontend");
    println!("cargo:rerun-if-changed=../vite.config.ts");
    println!("cargo:rerun-if-changed=../package.json");

    let status = Command::new("bun")
        .args(["run", "build:fe"])
        .current_dir("..")
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => println!("cargo:warning=frontend build exited with {s}"),
        Err(e) => println!("cargo:warning=frontend build not run ({e}); is `bun` on PATH?"),
    }
}
