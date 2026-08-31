'use strict';

// Statischer Einstiegspunkt für das arcade-glue-Bundle.
// Wird von esbuild in eine einzige CJS-Datei gebündelt (arcade-glue.js),
// damit Vercels Rolldown-Builder in Production keine Transitivabhängigkeiten
// von @solana/web3.js / @metaplex-foundation auflösen muss. Rolldown stubbed
// Chain-Module, die ESM-Transitivabhängigkeiten haben oder zu groß sind.

// web3 wird MIT gebündelt (kein --external), damit der gesamte Solana-Stack
// in einer einzigen quell-unabhängigen CJS-Datei steckt.
const web3 = require('@solana/web3.js');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const jwt = require('jsonwebtoken');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const { publicKey, createSignerFromKeypair } = require('@metaplex-foundation/umi');
const { createTree, mintV1 } = require('@metaplex-foundation/mpl-bubblegum');

module.exports = {
    web3,
    bs58: bs58.decode || (bs58.default && bs58.default.decode),
    nacl,
    jwt,
    createUmi,
    publicKey,
    createSignerFromKeypair,
    createTree,
    mintV1,
};