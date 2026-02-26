import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import bs58check from 'bs58check';

/*
 * Stake BCH into the LiquidStake contract and receive an lstBCH receipt NFT.
 *
 * Prerequisites:
 *   - Contract deployed with a minting NFT (run deploy.ts first)
 *   - Contract has enough BCH balance
 *
 * Usage:
 *   OWNER_WIF=<wif> STAKE_AMOUNT=50000 npx tsx src/stake.ts
 */

// Helper: hash160
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

// Helper: Encode PKH to Cash Address (base58check with double sha256)
function pkhToCashAddress(pkh: Uint8Array, network: 'bchtest' | 'bchreg' = 'bchtest'): string {
  const version = 0x00;
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(pkh)]);
  const address = bs58check.encode(payload);
  return `${network}:${address}`;
}

async function main() {
  const ownerWif = process.env.OWNER_WIF;
  if (!ownerWif) {
    console.error('❌ Set OWNER_WIF env var');
    console.error('   OWNER_WIF=<wif> STAKE_AMOUNT=50000 npx tsx src/stake.ts');
    process.exit(1);
  }

  const stakeAmount = BigInt(process.env.STAKE_AMOUNT ?? '50000');
  console.log(`🔒 Staking ${stakeAmount} sats...`);

  const provider = new ElectrumNetworkProvider('chipnet');
  const sigTemplate = new SignatureTemplate(ownerWif);

  // Derive owner PKH and address
  const pubkey = sigTemplate.getPublicKey();
  const ownerPkh = hash160(pubkey);
  const ownerAddress = pkhToCashAddress(ownerPkh, 'bchtest');

  console.log('👤 Owner address:', ownerAddress);

  // Compile & instantiate
  const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
  const contract = new Contract(artifact, [ownerPkh], { provider });

  console.log('📍 Contract address:', contract.address);
  console.log('📍 Token address:   ', contract.tokenAddress);

  // Get contract UTXOs — find the one with the minting NFT
  const contractUtxos = await contract.getUtxos();
  console.log(`📦 Contract UTXOs: ${contractUtxos.length}`);

  const mintingUtxo = contractUtxos.find(u =>
    u.token?.category && u.token?.nft?.capability === 'minting'
  );

  if (!mintingUtxo) {
    console.error('❌ No minting NFT found in contract. Run deploy flow first.');
    console.error('   Contract needs a UTXO with a minting-capability NFT.');
    process.exit(1);
  }

  console.log('✅ Found minting NFT:', mintingUtxo.token?.category);
  console.log('   Contract balance:', Number(mintingUtxo.satoshis), 'sats');

  // Get user's wallet UTXOs for funding
  console.log('\n📥 Fetching user wallet UTXOs...');
  
  try {
    const userUtxos = await provider.getUtxos(ownerAddress);
    
    if (!userUtxos || userUtxos.length === 0) {
      console.error('❌ No UTXOs found in user wallet:', ownerAddress);
      console.error('   Send some BCH to this address first.');
      process.exit(1);
    }

    // Find a UTXO with enough BCH for stake + fees
    const minRequired = Number(stakeAmount) + 2000; // stake amount + fees
    const fundingUtxo = userUtxos.find(u => Number(u.satoshis) >= minRequired);
    
    if (!fundingUtxo) {
      console.error('❌ No UTXO with enough balance. Need at least', minRequired, 'sats');
      const largest = Math.max(...userUtxos.map(u => Number(u.satoshis)));
      console.error('   Largest UTXO:', largest, 'sats');
      process.exit(1);
    }

    console.log('✅ Found funding UTXO:', Number(fundingUtxo.satoshis), 'sats');

    // Encode stake amount as 8-byte commitment (LE)
    const stakeAmountBytes = Buffer.alloc(8);
    stakeAmountBytes.writeBigUInt64LE(stakeAmount);
    const commitment = stakeAmountBytes.toString('hex');

    console.log('\n📝 Building stake transaction...');
    console.log('   Stake amount:', stakeAmount, 'sats');
    console.log('   Commitment:', commitment);

    // Build and send the stake transaction
    const tx = await contract.functions.stake()
      .from({
        txid: fundingUtxo.txid,
        vout: fundingUtxo.vout,
        value: fundingUtxo.satoshis,
        token: undefined
      })
      .to([
        {
          to: contract.tokenAddress,
          amount: BigInt(Number(mintingUtxo.satoshis) + Number(stakeAmount)),
          token: {
            category: mintingUtxo.token!.category!,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' }
          }
        },
        {
          to: ownerAddress,
          amount: 1000n,
          token: {
            category: mintingUtxo.token!.category!,
            amount: 0n,
            nft: { capability: 'none', commitment: commitment }
          }
        }
      ])
      .send();

    console.log('\n✅ Stake transaction sent!');
    console.log('   TXID:', tx.txid);
    console.log('   You received lstBCH NFT (receipt) at txid:', tx.txid, 'vout: 1');
    console.log('\n💡 To unstake, run:');
    console.log('   OWNER_WIF=<wif> NFT_TXID=' + tx.txid + ' NFT_VOUT=1 npx tsx src/unstake.ts');
    
    // Save transaction info
    const stakeInfo = {
      txid: tx.txid,
      receiptVout: 1,
      stakedAmount: stakeAmount.toString(),
      timestamp: new Date().toISOString()
    };
    writeFileSync('stake-info.json', JSON.stringify(stakeInfo, null, 2));
    console.log('✅ Saved stake-info.json');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('utxo')) {
      console.error('\n💡 Tips:');
      console.error('   - Make sure you have BCH in your wallet');
      console.error('   - The contract needs a minting NFT (run deploy with funding)');
    }
  }
}

main().catch(console.error);
