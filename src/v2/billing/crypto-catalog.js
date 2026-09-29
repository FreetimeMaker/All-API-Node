const CRYPTO_CATALOG = [
  ['bitcoin','BTC',['Bitcoin']], ['ethereum','ETH',['Ethereum']],
  ['tether','USDT',['Ethereum (ERC-20)','TRON (TRC-20)','BNB Smart Chain (BEP-20)','Solana','Polygon','Avalanche C-Chain','Arbitrum','Optimism']],
  ['usdc','USDC',['Ethereum (ERC-20)','Solana','Base','Arbitrum','Optimism','Polygon','Avalanche C-Chain']],
  ['bnb','BNB',['BNB Smart Chain (BEP-20)']], ['solana','SOL',['Solana']],
  ['cardano','ADA',['Cardano']], ['dogecoin','DOGE',['Dogecoin']], ['tron','TRX',['TRON']],
  ['polkadot','DOT',['Polkadot']], ['avalanche','AVAX',['Avalanche C-Chain','Avalanche P-Chain']],
  ['chainlink','LINK',['Ethereum (ERC-20)','BNB Smart Chain (BEP-20)','Polygon','Arbitrum','Optimism']],
  ['polygon','POL',['Polygon','Ethereum (ERC-20)']], ['litecoin','LTC',['Litecoin']],
  ['bitcoin_cash','BCH',['Bitcoin Cash']], ['stellar','XLM',['Stellar']], ['monero','XMR',['Monero']],
  ['toncoin','TON',['TON']], ['shiba_inu','SHIB',['Ethereum (ERC-20)','Shibarium']]
];

const NETWORK_KIND = {
  'Bitcoin':'UTXO','Litecoin':'UTXO','Dogecoin':'UTXO','Bitcoin Cash':'UTXO',
  'Ethereum':'EVM','Ethereum (ERC-20)':'EVM','BNB Smart Chain (BEP-20)':'EVM',
  'Polygon':'EVM','Avalanche C-Chain':'EVM','Arbitrum':'EVM','Optimism':'EVM','Base':'EVM','Shibarium':'EVM',
  'Solana':'SOLANA','Stellar':'STELLAR','Monero':'MONERO','TRON':'TRON','Cardano':'CARDANO',
  'Polkadot':'POLKADOT','Avalanche P-Chain':'AVALANCHE_P','TON':'TON'
};

function fundingKey(currency, network) { return currency + '::' + network; }
function catalogEntries() {
  return CRYPTO_CATALOG.flatMap(([currency,asset,networks]) =>
    networks.map(network => ({ id: fundingKey(currency,network), currency, asset, network, kind: NETWORK_KIND[network] }))
  );
}
function catalogEntry(id) { return catalogEntries().find(x => x.id === id) || null; }

module.exports = { CRYPTO_CATALOG, NETWORK_KIND, fundingKey, catalogEntries, catalogEntry };
