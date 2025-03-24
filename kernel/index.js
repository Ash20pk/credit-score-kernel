// Off-Chain Transaction Credit Score Kernel
// This kernel fetches transaction counts from multiple chains using Alchemy API
// and assigns a credit score based on user activity

const express = require('express');
const { Alchemy, Network } = require('alchemy-sdk');
const cors = require('cors');
require('dotenv').config();

// Enable debug messages for testing
const DEBUG = process.env.DEBUG === 'true';

const app = express();
app.use(express.json());

// CORS middleware specifically configured for requests from platform.lat
app.use((req, res, next) => {
    const allowedOrigins = ['https://app.platform.lat', 'http://localhost:3000'];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

// Configure Alchemy for different networks
// Set to true for networks that are enabled in your Alchemy account
const ENABLED_NETWORKS = {
  ethereum: true,   // Ethereum Mainnet
  polygon: true,    // Polygon Mainnet
  arbitrum: true,   // Arbitrum
  optimism: true,   // Optimism
  base: true,       // Base
  avalanche: true,  // Avalanche C-Chain
  bsc: true,        // Binance Smart Chain
  fantom: true,     // Fantom
  zksync: true      // zkSync Era
};

// Network configurations
const networks = {
  ethereum: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY,
      network: Network.ETH_MAINNET,
    },
    weight: 1.0, // Base weight for Ethereum transactions
    enabled: ENABLED_NETWORKS.ethereum,
    // Flag to indicate which networks support internal transactions
    supportsInternalTx: true
  },
  polygon: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_POLYGON || process.env.ALCHEMY_API_KEY,
      network: Network.MATIC_MAINNET,
    },
    weight: 0.8, // Weight for Polygon transactions
    enabled: ENABLED_NETWORKS.polygon,
    supportsInternalTx: true
  },
  arbitrum: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_ARBITRUM || process.env.ALCHEMY_API_KEY,
      network: Network.ARB_MAINNET,
    },
    weight: 0.7, // Weight for Arbitrum transactions
    enabled: ENABLED_NETWORKS.arbitrum,
    supportsInternalTx: false
  },
  optimism: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_OPTIMISM || process.env.ALCHEMY_API_KEY,
      network: Network.OPT_MAINNET,
    },
    weight: 0.7, // Weight for Optimism transactions
    enabled: ENABLED_NETWORKS.optimism,
    supportsInternalTx: true
  },
  base: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_BASE || process.env.ALCHEMY_API_KEY,
      network: Network.BASE_MAINNET,
    },
    weight: 0.7, // Weight for Base transactions
    enabled: ENABLED_NETWORKS.base,
    supportsInternalTx: false
  },
  avalanche: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_AVALANCHE || process.env.ALCHEMY_API_KEY,
      network: Network.AVALANCHE_MAINNET, // Check if this is supported in your Alchemy SDK version
    },
    weight: 0.7, // Weight for Avalanche transactions
    enabled: ENABLED_NETWORKS.avalanche && Network.AVALANCHE_MAINNET !== undefined,
    supportsInternalTx: false
  },
  bsc: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_BSC || process.env.ALCHEMY_API_KEY,
      network: Network.BSC_MAINNET, // Check if this is supported in your Alchemy SDK version
    },
    weight: 0.6, // Weight for BSC transactions
    enabled: ENABLED_NETWORKS.bsc && Network.BSC_MAINNET !== undefined,
    supportsInternalTx: false
  },
  fantom: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_FANTOM || process.env.ALCHEMY_API_KEY,
      network: Network.FANTOM_MAINNET, // Check if this is supported in your Alchemy SDK version
    },
    weight: 0.6, // Weight for Fantom transactions
    enabled: ENABLED_NETWORKS.fantom && Network.FANTOM_MAINNET !== undefined,
    supportsInternalTx: false
  },
  zksync: {
    config: {
      apiKey: process.env.ALCHEMY_API_KEY_ZKSYNC || process.env.ALCHEMY_API_KEY,
      network: Network.ZKSYNC_MAINNET, // Check if this is supported in your Alchemy SDK version
    },
    weight: 0.7, // Weight for zkSync transactions
    enabled: ENABLED_NETWORKS.zksync && Network.ZKSYNC_MAINNET !== undefined,
    supportsInternalTx: false
  }
};

// Create Alchemy instances for each enabled network
const alchemyInstances = {};
for (const [network, config] of Object.entries(networks)) {
  if (config.enabled) {
    try {
      console.log(`Initializing Alchemy for ${network}...`);
      
      // Check if the network is actually defined in the Alchemy SDK
      if (config.config.network !== undefined) {
        alchemyInstances[network] = new Alchemy(config.config);
      } else {
        console.log(`Network ${network} is not supported in your Alchemy SDK version.`);
      }
    } catch (error) {
      console.error(`Failed to initialize Alchemy for ${network}:`, error);
      // Don't add this network to alchemyInstances
    }
  } else {
    console.log(`Network ${network} is disabled in configuration.`);
  }
}

/**
 * Calculate credit score based on transaction data
 * @param {Object} txData - Transaction data from multiple chains
 * @param {Number} accountAgeInDays - Age of the wallet in days
 * @returns {Number} - Credit score between 300-850
 */
function calculateCreditScore(txData, accountAgeInDays) {
  // Credit score calculation parameters
  const MAX_SCORE = parseInt(process.env.MAX_SCORE || '850');
  const MIN_SCORE = parseInt(process.env.MIN_SCORE || '300');
  
  // Updated weights for different components
  const TX_COUNT_WEIGHT = 0.5;
  const AGE_WEIGHT = 0.3;
  const ACTIVITY_WEIGHT = 0.2; // New component for cross-chain activity
  
  // Thresholds for maximum scores
  const MAX_TX_COUNT = 500; // Reduced from 1000 for more realistic scoring
  const MAX_ACCOUNT_AGE_DAYS = 730; // 2 years
  const MAX_NETWORKS = 5; // Maximum number of networks to consider for activity score
  
  // Calculate weighted transaction count
  let totalWeightedTxCount = 0;
  let totalTransactions = 0;
  let activeNetworks = 0;
  
  for (const [network, data] of Object.entries(txData)) {
    // Get the network weight or default to 0.5 if not found
    const networkWeight = networks[network]?.weight || 0.5;
    
    // Add the weighted transaction count
    totalWeightedTxCount += data.count * networkWeight;
    totalTransactions += data.count;
    
    // Count active networks (with at least 3 transactions)
    if (data.count >= 3) {
      activeNetworks++;
    }
  }
  
  // Calculate transaction component (0-1)
  // Using a logarithmic scale to reward early transactions more heavily
  const txComponent = totalWeightedTxCount > 0 ? 
    Math.min(Math.log(totalWeightedTxCount + 1) / Math.log(MAX_TX_COUNT + 1), 1) : 0;
  
  // Calculate age component (0-1) - again with diminishing returns
  // Add a small bonus for new wallets with transactions to avoid penalizing them too heavily
  const ageBonus = totalTransactions > 0 && accountAgeInDays < 30 ? 0.1 : 0;
  const ageComponent = Math.min(
    Math.sqrt(accountAgeInDays / MAX_ACCOUNT_AGE_DAYS) + ageBonus,
    1
  );
  
  // Calculate activity component (0-1) - rewards using multiple chains
  const activityComponent = Math.min(activeNetworks / MAX_NETWORKS, 1);
  
  // Calculate final score with all three components
  const weightedScore = 
    (txComponent * TX_COUNT_WEIGHT) + 
    (ageComponent * AGE_WEIGHT) + 
    (activityComponent * ACTIVITY_WEIGHT);
  
  const finalScore = MIN_SCORE + weightedScore * (MAX_SCORE - MIN_SCORE);
  
  if (DEBUG) {
    console.log('Credit Score Components:');
    console.log(`- Transaction Component: ${(txComponent * 100).toFixed(2)}% (weight: ${TX_COUNT_WEIGHT})`);
    console.log(`- Age Component: ${(ageComponent * 100).toFixed(2)}% (weight: ${AGE_WEIGHT})`);
    console.log(`- Activity Component: ${(activityComponent * 100).toFixed(2)}% (weight: ${ACTIVITY_WEIGHT})`);
    console.log(`- Total Weighted Score: ${(weightedScore * 100).toFixed(2)}%`);
    console.log(`- Final Score: ${Math.round(finalScore)}`);
  }
  
  return {
    score: Math.round(finalScore),
    txCount: totalTransactions,
    weightedTxCount: totalWeightedTxCount,
    txComponent,
    ageComponent,
    activityComponent,
    activeNetworks,
    details: txData,
    accountAgeInDays,
    status: Math.round(finalScore) >= (parseInt(process.env.PASS_THRESHOLD || '600')) ? "pass" : "fail"
  };
}

// GET endpoint for wallet scoring
app.get('/wallet-score/:wallet_address', async (req, res) => {
  try {
    const walletAddress = req.params.wallet_address;
    
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    console.log(`Processing request for wallet: ${walletAddress}`);
    
    // Fetch transaction counts from multiple chains
    const txData = {};
    const fetchPromises = [];
    
    // Initialize txData for all networks (even disabled ones) to ensure consistent response structure
    for (const network of Object.keys(networks)) {
      txData[network] = { count: 0, firstTxTimestamp: null };
    }
    
    // Only fetch data for enabled networks
    for (const [network, alchemy] of Object.entries(alchemyInstances)) {
      fetchPromises.push(
        (async () => {
          try {
            if (DEBUG) console.log(`Fetching data from ${network}...`);
            
            // Get transaction count with timeout to prevent hanging
            const txCountPromise = alchemy.core.getTransactionCount(walletAddress);
            const txCount = await Promise.race([
              txCountPromise,
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Timeout fetching transaction count for ${network}`)), 10000)
              )
            ]);
            
            if (DEBUG) console.log(`${network} transaction count: ${txCount}`);
            
            // Get first transaction (to estimate account age)
            let firstTxTimestamp = null;
            
            // If we have transactions, try to get the timestamp of the first one
            if (txCount > 0) {
              if (DEBUG) console.log(`Fetching first transaction data from ${network}...`);
              
              try {
                // First try getting transfer history
                // Customize transfer categories based on network
                // Some networks don't support all categories - FIX FOR THE ERROR
                let categories = ["external", "erc20", "erc721", "erc1155"];
                
                // Only add "internal" category for networks that support it
                if (networks[network].supportsInternalTx) {
                  categories.push("internal");
                }
                
                const historyPromise = alchemy.core.getAssetTransfers({
                  fromAddress: walletAddress,
                  category: categories,
                  maxCount: 1,
                  order: "asc"
                });
                
                const history = await Promise.race([
                  historyPromise,
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Timeout fetching transfer history for ${network}`)), 10000)
                  )
                ]);
                
                if (history.transfers && history.transfers.length > 0 && 
                    history.transfers[0].metadata && 
                    history.transfers[0].metadata.blockTimestamp) {
                  firstTxTimestamp = new Date(history.transfers[0].metadata.blockTimestamp).getTime();
                  if (DEBUG) console.log(`First transaction on ${network}: ${new Date(firstTxTimestamp).toISOString()}`);
                } else {
                  if (DEBUG) console.log(`No valid transaction history found for ${network}`);
                }
                
                // If we couldn't get the timestamp from transfer history, try a different approach
                if (!firstTxTimestamp && txCount > 0) {
                  try {
                    if (DEBUG) console.log(`Attempting alternate method for ${network}...`);
                    
                    // Since getHistory isn't available, we'll use another approach
                    // Try to get more transfers to find one with a timestamp
                    const moreTransfersPromise = alchemy.core.getAssetTransfers({
                      fromAddress: walletAddress,
                      category: categories,
                      maxCount: 10, // Try getting more transfers
                      order: "asc"
                    });
                    
                    const moreTransfers = await Promise.race([
                      moreTransfersPromise,
                      new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Timeout fetching more transfers for ${network}`)), 10000)
                      )
                    ]);
                    
                    // Look through all transfers for a valid timestamp
                    if (moreTransfers && moreTransfers.transfers) {
                      for (const transfer of moreTransfers.transfers) {
                        if (transfer.metadata && transfer.metadata.blockTimestamp) {
                          firstTxTimestamp = new Date(transfer.metadata.blockTimestamp).getTime();
                          if (DEBUG) console.log(`Found timestamp in additional transfers: ${new Date(firstTxTimestamp).toISOString()}`);
                          break;
                        }
                      }
                    }
                  } catch (alternateError) {
                    console.error(`Error with alternate method for ${network}:`, alternateError);
                    // Continue with null firstTxTimestamp
                  }
                  
                  // If we still don't have a timestamp, try just ERC20 transfers
                  if (!firstTxTimestamp) {
                    try {
                      if (DEBUG) console.log(`Trying ERC20-only method for ${network}...`);
                      
                      const erc20TransfersPromise = alchemy.core.getAssetTransfers({
                        fromAddress: walletAddress,
                        category: ["erc20"], // Only ERC20 transfers
                        maxCount: 5,
                        order: "asc"
                      });
                      
                      const erc20Transfers = await Promise.race([
                        erc20TransfersPromise,
                        new Promise((_, reject) => 
                          setTimeout(() => reject(new Error(`Timeout fetching ERC20 transfers for ${network}`)), 10000)
                        )
                      ]);
                      
                      if (erc20Transfers && erc20Transfers.transfers && erc20Transfers.transfers.length > 0) {
                        const transfer = erc20Transfers.transfers[0];
                        if (transfer.metadata && transfer.metadata.blockTimestamp) {
                          firstTxTimestamp = new Date(transfer.metadata.blockTimestamp).getTime();
                          if (DEBUG) console.log(`Found timestamp in ERC20 transfer: ${new Date(firstTxTimestamp).toISOString()}`);
                        }
                      }
                    } catch (erc20Error) {
                      console.error(`Error with ERC20 method for ${network}:`, erc20Error);
                    }
                  }
                  
                  // If we still don't have a timestamp, try NFT ownership as a last resort
                  // FIX for NFT query error - Remove excludeFilters parameter
                  if (!firstTxTimestamp && network === "ethereum") { // Only try this on Ethereum for now
                    try {
                      if (DEBUG) console.log(`Trying NFT ownership method for ${network}...`);
                      
                      // Get NFTs owned by the address - REMOVED excludeFilters parameter
                      const nftsPromise = alchemy.nft.getNftsForOwner(walletAddress, {
                        pageSize: 5
                        // Removed excludeFilters parameter which requires a paid plan
                      });
                      
                      const nfts = await Promise.race([
                        nftsPromise,
                        new Promise((_, reject) => 
                          setTimeout(() => reject(new Error(`Timeout fetching NFTs for ${network}`)), 10000)
                        )
                      ]);
                      
                      if (nfts && nfts.ownedNfts && nfts.ownedNfts.length > 0) {
                        if (DEBUG) console.log(`Found ${nfts.ownedNfts.length} NFTs owned by this address`);
                        
                        // Check mint dates if available
                        for (const nft of nfts.ownedNfts) {
                          if (nft.acquiredAt) {
                            const mintTimestamp = new Date(nft.acquiredAt).getTime();
                            if (DEBUG) console.log(`Found NFT mint date: ${new Date(mintTimestamp).toISOString()}`);
                            
                            // Only use this if we don't have a better timestamp
                            if (!firstTxTimestamp || mintTimestamp < firstTxTimestamp) {
                              firstTxTimestamp = mintTimestamp;
                            }
                            break;
                          }
                        }
                      }
                    } catch (nftError) {
                      console.error(`Error with NFT method for ${network}:`, nftError);
                    }
                  }
                }
              } catch (historyError) {
                console.error(`Error fetching transaction history for ${network}:`, historyError);
                // Continue with null firstTxTimestamp
              }
            }
            
            txData[network] = {
              count: txCount,
              firstTxTimestamp
            };
          } catch (error) {
            console.error(`Error fetching data for ${network}:`, error);
            // txData[network] already initialized with zeros
          }
        })()
      );
    }
    
    console.log('Waiting for all blockchain queries to complete...');
    await Promise.allSettled(fetchPromises); // Changed to Promise.allSettled to continue even if some fail
    
    // Calculate account age (using the oldest first transaction across chains)
    let oldestTxTimestamp = null;
    let hasTxButNoTimestamp = false;
    
    for (const [network, data] of Object.entries(txData)) {
      // Track if we have transactions but no timestamp
      if (data.count > 0 && !data.firstTxTimestamp) {
        hasTxButNoTimestamp = true;
      }
      
      if (data.firstTxTimestamp && (!oldestTxTimestamp || data.firstTxTimestamp < oldestTxTimestamp)) {
        oldestTxTimestamp = data.firstTxTimestamp;
        if (DEBUG) console.log(`Oldest transaction found on ${network}`);
      }
    }
    
    // Calculate account age in days
    let accountAgeInDays = 0;
    
    if (oldestTxTimestamp) {
      accountAgeInDays = Math.floor((Date.now() - oldestTxTimestamp) / (1000 * 60 * 60 * 24));
      if (DEBUG) console.log(`Account age in days (from timestamp): ${accountAgeInDays}`);
    } 
    // If we have transactions but couldn't find any timestamp, use a conservative estimate
    else if (hasTxButNoTimestamp) {
      // Estimate based on total transaction count across all chains
      const totalTxCount = Object.values(txData).reduce((sum, data) => sum + data.count, 0);
      
      // Rough estimate: 5 days per transaction, capped at 365 days
      accountAgeInDays = Math.min(totalTxCount * 5, 365);
      if (DEBUG) console.log(`Couldn't determine first transaction date. Estimated age: ${accountAgeInDays} days`);
    }
    
    // Calculate credit score
    console.log('Calculating credit score...');
    const scoreResult = calculateCreditScore(txData, accountAgeInDays);
    
    // Get pass threshold from env or default to 600
    const passThreshold = parseInt(process.env.PASS_THRESHOLD || '600');
    
    console.log(`Final score calculated: ${scoreResult.score} (${scoreResult.score > passThreshold ? "pass" : "fail"})`);
    
    // Return just the score
    res.json(scoreResult.score);
    
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: DEBUG ? error.stack : undefined
    });
  }
});

// POST endpoint for wallet scoring (alternative method)
app.post('/wallet-score', async (req, res) => {
  try {
    const { wallet_address } = req.body;
    
    if (!wallet_address || !wallet_address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Redirect to GET handler to avoid code duplication
    req.params.wallet_address = wallet_address;
    app.handle(req, res);
    
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Transaction Credit Score Kernel running on port ${PORT}`);
});