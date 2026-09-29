const EVM_NETWORKS = {
  'Ethereum': { chainId: 1, rpcEnv: 'EVM_ETHEREUM_RPC_URL' },
  'Ethereum (ERC-20)': { chainId: 1, rpcEnv: 'EVM_ETHEREUM_ERC_20_RPC_URL', fallbackRpcEnv: 'EVM_ETHEREUM_RPC_URL' },
  'BNB Smart Chain (BEP-20)': { chainId: 56, rpcEnv: 'EVM_BNB_SMART_CHAIN_BEP_20_RPC_URL' },
  'Polygon': { chainId: 137, rpcEnv: 'EVM_POLYGON_RPC_URL' },
  'Avalanche C-Chain': { chainId: 43114, rpcEnv: 'EVM_AVALANCHE_C_CHAIN_RPC_URL' },
  'Arbitrum': { chainId: 42161, rpcEnv: 'EVM_ARBITRUM_RPC_URL' },
  'Optimism': { chainId: 10, rpcEnv: 'EVM_OPTIMISM_RPC_URL' },
  'Base': { chainId: 8453, rpcEnv: 'EVM_BASE_RPC_URL' },
  'Shibarium': { chainId: 109, rpcEnv: 'EVM_SHIBARIUM_RPC_URL' }
};

// Contract addresses deliberately live in configuration rather than verifier logic.
// Environment values override defaults so contracts can be rotated without code changes.
const TOKEN_CONTRACTS = {
  'USDC::Ethereum (ERC-20)': process.env.USDC_ETHEREUM_CONTRACT || '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'USDC::Base': process.env.USDC_BASE_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'USDC::Arbitrum': process.env.USDC_ARBITRUM_CONTRACT || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  'USDC::Optimism': process.env.USDC_OPTIMISM_CONTRACT || '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  'USDC::Polygon': process.env.USDC_POLYGON_CONTRACT || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  'USDC::Avalanche C-Chain': process.env.USDC_AVALANCHE_CONTRACT || '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  'USDT::Ethereum (ERC-20)': process.env.USDT_ETHEREUM_CONTRACT || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'LINK::Ethereum (ERC-20)': process.env.LINK_ETHEREUM_CONTRACT || '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  'SHIB::Ethereum (ERC-20)': process.env.SHIB_ETHEREUM_CONTRACT || '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE'
};

function evmConfig(network) { return EVM_NETWORKS[network] || null; }
function tokenContract(asset, network) {
  return process.env['TOKEN_' + asset + '_' + network.toUpperCase().replace(/[^A-Z0-9]+/g,'_') + '_CONTRACT']
      || TOKEN_CONTRACTS[asset + '::' + network] || null;
}
module.exports = { EVM_NETWORKS, TOKEN_CONTRACTS, evmConfig, tokenContract };
