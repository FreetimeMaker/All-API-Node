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

const CONTRACTS = {
  'tether::Ethereum (ERC-20)': { type:'evm', env:'USDT_ETHEREUM_CONTRACT', value:'0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  'usdc::Ethereum (ERC-20)': { type:'evm', env:'USDC_ETHEREUM_CONTRACT', value:'0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  'usdc::Base': { type:'evm', env:'USDC_BASE_CONTRACT', value:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  'usdc::Arbitrum': { type:'evm', env:'USDC_ARBITRUM_CONTRACT', value:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  'usdc::Optimism': { type:'evm', env:'USDC_OPTIMISM_CONTRACT', value:'0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  'usdc::Polygon': { type:'evm', env:'USDC_POLYGON_CONTRACT', value:'0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  'usdc::Avalanche C-Chain': { type:'evm', env:'USDC_AVALANCHE_CONTRACT', value:'0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
  'usdc::Solana': { type:'spl', env:'SOLANA_USDC_MINT', value:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  'tether::Solana': { type:'spl', env:'SOLANA_USDT_MINT', value:null },
  'chainlink::Ethereum (ERC-20)': { type:'evm', env:'LINK_ETHEREUM_CONTRACT', value:'0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  'shiba_inu::Ethereum (ERC-20)': { type:'evm', env:'SHIB_ETHEREUM_CONTRACT', value:'0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' }
};

function fundingKey(currency, network) { return currency + '::' + network; }
function catalogEntries() {
  return CRYPTO_CATALOG.flatMap(([currency,asset,networks]) =>
    networks.map(network => {
      const id = fundingKey(currency, network);
      const contract = CONTRACTS[id] || null;
      return { id, currency, asset, network, kind: NETWORK_KIND[network],
        contractType: contract?.type || null,
        contract: contract ? (process.env[contract.env] || contract.value) : null,
        contractEnv: contract?.env || null };
    })
  );
}
function catalogEntry(id) { return catalogEntries().find(x => x.id === id) || null; }

module.exports = { CRYPTO_CATALOG, NETWORK_KIND, CONTRACTS, fundingKey, catalogEntries, catalogEntry };
