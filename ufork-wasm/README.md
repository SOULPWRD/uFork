# uFork Simulator in Rust

This [implementation](vm.md) of the [**uFork** virtual machine](../ufork.md)
is written in [Rust](https://www.rust-lang.org/)
and targets the browser's [WASM engine](https://webassembly.org/).
A browser-based GUI implements a debugger for a uFork processor core.

## Running the native test suite

1. Run `cargo test --lib`

## Running the browser-based demo

1. Run `cargo build --target wasm32-unknown-unknown`
2. Run `node www/server.js`
3. Navigate to the printed URL
