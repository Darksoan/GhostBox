fn main() {
    println!("cargo:rerun-if-changed=../Icons/desktopicon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/desktopicon.ico");
    tauri_build::build()
}
