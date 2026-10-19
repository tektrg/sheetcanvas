declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '*.bin' {
  const data: ArrayBuffer;
  export default data;
}
