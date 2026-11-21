# In-app chess engine

`stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm` are copied unmodified from the
npm package `stockfish@19.0.1` (Stockfish.js by Nathan Rugg, a WebAssembly build of Stockfish 19;
https://github.com/nmrugg/stockfish.js). Licence: GPL-3.0, see `COPYING.txt`.

    sha256 ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a  stockfish-19-lite-single.js
    sha256 ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de  stockfish-19-lite-single.wasm

This is the single-threaded "lite" flavour (small network, no cross-origin isolation needed), used
only to analyse the owner's own games on the device. It is weaker than the native engine used on
the Mac; analyses made with it are labelled with their own engine name and node budget.
