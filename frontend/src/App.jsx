import React, { useState } from 'react';
import { ethers } from 'krnl-sdk';
import { contractAbi } from './abi';
import logo from './assets/KRNL_Logo.svg';
import {WalletMinimal} from 'lucide-react';

const TransactionCreditScoreApp = () => {
  const [walletAddress, setWalletAddress] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scoreFromEvent, setScoreFromEvent] = useState(null);
  const [error, setError] = useState('');
  const [transactionHash, setTransactionHash] = useState('');
  const [loadingStep, setLoadingStep] = useState('');

  // Constants for KRNL integration
  const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
  const entryId = import.meta.env.VITE_ENTRY_ID;
  const accessToken = import.meta.env.VITE_ACCESS_TOKEN;
  const provider = new ethers.JsonRpcProvider(import.meta.env.VITE_PROVIDER_URL);
    
  const connectWallet = async () => {
    setIsConnecting(true);
    setError('');
    
    try {
      // Check if MetaMask is installed
      if (window.ethereum) {
        // Check if network is Sepolia (chainId 11155111) before connecting
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        
        if (chainId !== '0xaa36a7') { // 0xaa36a7 is hex for 11155111 (Sepolia)
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0xaa36a7' }],
            });
          } catch (switchError) {
            // This error code indicates that the chain has not been added to MetaMask
            if (switchError.code === 4902) {
              try {
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: '0xaa36a7',
                    rpcUrls: ['https://1rpc.io/sepolia'],
                    chainName: 'Sepolia',
                    nativeCurrency: {
                      name: 'SepoliaETH',
                      symbol: 'ETH',
                      decimals: 18
                    },
                    blockExplorerUrls: ['https://sepolia.etherscan.io/']
                  }],
                });
              } catch (addError) {
                setError('Failed to add Sepolia network to your wallet');
                setIsConnecting(false);
                return;
              }
            } else {
              setError('Please switch to Sepolia network in your wallet');
              setIsConnecting(false);
              return;
            }
          }
        }
        
        // Request account access after ensuring correct network
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];
        
        setConnectedAddress(address);
        setIsConnected(true);
        setWalletAddress(address); // Auto-fill the input field with connected wallet
      } else {
        setError('Please install MetaMask to connect your wallet');
      }
    } catch (err) {
      setError('Failed to connect wallet: ' + err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const executeKrnl = async (addressToCheck) => {
    setIsLoading(true);
    setError('');
    setScoreFromEvent(null);
    setLoadingStep('Initializing kernel request');
    
    try {
      // Use the connected wallet address for the sender
      const senderAddress = connectedAddress || ethers.ZeroAddress;
      
      // Format the parameters for the credit score kernel
      const kernelRequestData = {
        senderAddress: senderAddress,
        kernelPayload: {
          "1346": { // Transaction Credit Score Kernel ID
            "parameters": {
              "header": {},
              "body": {},
              "query": {},
              "path": {
                "wallet_address": addressToCheck
              }
            }
          }
        }
      };

      const textInput = "Check wallet score";
      const abiCoder = new ethers.AbiCoder();
      const functionParams = abiCoder.encode(["string"], [textInput]);

      // Execute the kernel call
      setLoadingStep('Contacting KRNL node');
      const krnlPayload = await provider.executeKernels(
        entryId,
        accessToken,
        kernelRequestData,
        functionParams
      );

      setLoadingStep('Kernel response received');
      console.log("krnlPayload", krnlPayload.kernel_responses);
      
      // If connected to wallet, execute the transaction and listen for event
      if (isConnected && window.ethereum) {
        try {
          setLoadingStep('Preparing smart contract transaction');
          const web3Provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await web3Provider.getSigner();
          
          const contract = new ethers.Contract(contractAddress, contractAbi, signer);
          
          const krnlPayloadForContract = {
            auth: krnlPayload.auth,
            kernelResponses: krnlPayload.kernel_responses,
            kernelParams: krnlPayload.kernel_params
          };
          
          // Set up event listener before sending transaction
          contract.on('Broadcast', (sender, score, message, event) => {
            console.log("Broadcast event received:", sender, score, message);
            // Convert BigNumber to Number (assuming it's in wei with 18 decimals)
            const scoreNumber = Number(ethers.formatUnits(score, 18));
            setScoreFromEvent(scoreNumber);
            setLoadingStep('Score verified on-chain');
            
            // Clean up listener after receiving event
            contract.removeAllListeners();
          });
          
          setLoadingStep('Sending transaction');
          const tx = await contract.protectedFunction(krnlPayloadForContract, textInput);
          setTransactionHash(tx.hash);
          
          // Wait for transaction to be mined to ensure event is captured
          setLoadingStep('Waiting for transaction confirmation');
          await tx.wait();
          setLoadingStep('Transaction confirmed');
          
          // If after waiting for transaction, we still don't have event data
          // set a timeout to remove listeners after reasonable time
          setTimeout(() => {
            contract.removeAllListeners();
          }, 10000);
        } catch (txError) {
          console.error("Transaction error:", txError);
          setError('Transaction error: ' + txError.message);
        }
      } 
    } catch (err) {
      setError('Error executing kernel: ' + err.message);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Please enter a valid wallet address');
      return;
    }
    
    executeKrnl(walletAddress);
  };

  // Function to determine color based on score value
  const getScoreColor = (score) => {
    if (score >= 750) return 'text-green-500';
    if (score >= 600) return 'text-blue-500';
    if (score >= 450) return 'text-yellow-500';
    return 'text-red-500';
  };

  // Function to get score rating description
  const getScoreRating = (score) => {
    if (score >= 750) return 'Excellent';
    if (score >= 600) return 'Good';
    if (score >= 450) return 'Fair';
    return 'Poor';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="text-white">Transaction</span>
            <span style={{ color: 'oklch(0.464198 0.303088 264.197)' }}> Credit Score</span>
          </h1>
          <p className="text-lg text-gray-300">Cross-chain transaction analysis for wallet evaluation</p>
        </header>

        <div className="bg-black bg-opacity-40 rounded-2xl shadow-2xl p-6 backdrop-blur-sm border border-gray-800 border-opacity-70 mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h2 className="text-2xl font-semibold">Wallet Evaluation</h2>
            {!isConnected ? (
              <button 
                onClick={connectWallet}
                disabled={isConnecting}
                className="px-5 py-2.5 rounded-lg font-medium transition-all disabled:opacity-50 flex items-center"
                style={{ backgroundColor: 'oklch(0.464198 0.303088 264.197)' }}
              >
                {isConnecting ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Connecting...
                  </>
                ) : (
                  <>
                    <WalletMinimal className="h-5 w-5 mr-2" />
                    Connect Wallet
                  </>
                )}
              </button>
            ) : (
              <div className="flex items-center bg-gray-800 bg-opacity-60 px-3 py-1.5 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-green-400 mr-2"></div>
                <span className="text-sm font-medium truncate max-w-xs">
                  {connectedAddress.substring(0, 6)}...{connectedAddress.substring(connectedAddress.length - 4)}
                </span>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="Enter wallet address (0x...)"
                  className="w-full pl-10 pr-4 py-3 rounded-lg bg-gray-900 bg-opacity-70 border border-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-opacity-50"
                  style={{ focusRing: 'oklch(0.464198 0.303088 264.197)' }}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-3 rounded-lg font-semibold transition-all disabled:opacity-50 flex items-center justify-center"
                style={{ backgroundColor: 'oklch(0.464198 0.303088 264.197)' }}
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Analyzing...
                  </>
                ) : (
                  'Check Score'
                )}
              </button>
            </div>
            {error && (
              <div className="mt-3 bg-red-900 bg-opacity-30 text-red-400 text-sm p-3 rounded-lg border border-red-900 flex items-start">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}
          </form>
        </div>

        {isLoading && (
          <div className="bg-black bg-opacity-40 rounded-2xl shadow-2xl p-8 backdrop-blur-sm border border-gray-800 border-opacity-70 mb-8">
            <div className="flex flex-col items-center justify-center py-6">
              <div className="relative">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-white"></div>
                <div 
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ color: 'oklch(0.464198 0.303088 264.197)' }}
                >
                </div>
              </div>
              <div className="mt-4 text-lg font-medium">
                {loadingStep === 'Contacting KRNL node' ? (
                  <div className="flex items-center justify-center">
                    <img src={logo} className="w-6 h-6 mr-2" />
                    Contacting KRNL node
                  </div>
                ) : loadingStep}
              </div>
              <div className="mt-8 max-w-md">
                <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full animate-pulse"
                    style={{ 
                      backgroundColor: 'oklch(0.464198 0.303088 264.197)',
                      width: loadingStep.includes('Transaction') ? '80%' : loadingStep.includes('Kernel') ? '50%' : '30%' 
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {scoreFromEvent && !isLoading && (
          <div className="bg-black bg-opacity-40 rounded-2xl shadow-2xl backdrop-blur-sm border border-gray-800 border-opacity-70 overflow-hidden">
            <div className="p-6 md:p-8">
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold mb-6">Credit Score Result</h2>
                <div className="flex flex-col items-center">
                  <div className="relative">
                    <svg className="w-48 h-48" viewBox="0 0 100 100">
                      <circle 
                        cx="50" 
                        cy="50" 
                        r="45" 
                        fill="none" 
                        stroke="#333" 
                        strokeWidth="10"
                      />
                      <circle 
                        cx="50" 
                        cy="50" 
                        r="45" 
                        fill="none" 
                        stroke={scoreFromEvent >= 750 ? '#10B981' : scoreFromEvent >= 600 ? 'oklch(0.464198 0.303088 264.197)' : scoreFromEvent >= 450 ? '#F59E0B' : '#EF4444'} 
                        strokeWidth="10"
                        strokeDasharray="282.7"
                        strokeDashoffset={282.7 - (282.7 * (scoreFromEvent - 300) / 550)}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className={`text-5xl font-bold ${getScoreColor(scoreFromEvent)}`}>
                        {scoreFromEvent}
                      </div>
                      <div className="text-sm text-gray-400 mt-1">{getScoreRating(scoreFromEvent)}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 inline-block px-4 py-1 rounded-full text-sm font-medium" 
                  style={{ 
                    backgroundColor: scoreFromEvent >= 600 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: scoreFromEvent >= 600 ? '#10B981' : '#EF4444',
                    border: `1px solid ${scoreFromEvent >= 600 ? '#10B98140' : '#EF444440'}`
                  }}>
                  {scoreFromEvent >= 600 ? 'PASS' : 'FAIL'} (Threshold: 600)
                </div>
              </div>

              {transactionHash && (
                <div className="mb-6 p-4 bg-gray-800 bg-opacity-30 rounded-lg border border-gray-700">
                  <h3 className="text-green-400 text-sm font-medium mb-2 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Transaction Submitted
                  </h3>
                  <div className="flex items-center">
                    <span className="text-xs text-gray-400 mr-2">Tx Hash:</span>
                    <a 
                      href={`https://sepolia.etherscan.io/tx/${transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs hover:text-blue-300 break-all flex-1 truncate"
                      style={{ color: 'oklch(0.464198 0.303088 264.197)' }}
                    >
                      {transactionHash}
                    </a>
                    <button 
                      onClick={() => navigator.clipboard.writeText(transactionHash)}
                      className="ml-2 p-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
                      title="Copy to clipboard"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            <div className="bg-gray-900 p-4 border-t border-gray-800 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-gray-400">
                Powered by KRNL's Transaction Credit Score Kernel (ID: 1346)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionCreditScoreApp;