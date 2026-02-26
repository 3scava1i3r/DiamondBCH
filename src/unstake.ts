import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import bs58check from 'bs58check';

/*
 * Unstake BCH from the LiquidStake contract by burning the lstBCH receipt NFT.
 *
 * Prerequisites:
 *   - Successfully ran stake.ts and received an lstBCH NFT
 *   - Know the transaction ID where you received the lstBCH NFT
 *
 * Usage:
 *   OWNER_WIF=<wif> NFT_TXID=<txid> NFT_VOUT=<vout> npx tsx src/unstake.ts
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
    console.error('   OWNER_WIF=<wif> NFT_TXID=<txid> NFT_VOUT=<vout> npx tsx src/unstake.ts');
    process.exit(1);
  }

  const nftTxId = process.env.NFT_TXID;
  const nftVout = parseInt(process.env.NFT_VOUT ?? '1');
  
  if (!nftTxId) {
    console.error('❌ Set NFT_TXID env var (the transaction where you received lstBCH NFT)');
    console.error('   Example: NFT_TXID=abc123... NFT_VOUT=1 npx tsx src/unstake.ts');
    process.exit(1);
  }

  console.log(`🔥 Unstaking from NFT: ${nftTxId}:${nftVout}`);

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
    console.error('❌ No minting NFT found in contract.');
    console.error('   The contract may not be properly initialized.');
    process.exit(1);
  }

  console.log('✅ Found minting NFT:', mintingUtxo.token?.category);
  console.log('   Contract balance:', Number(mintingUtxo.satoshis), 'sats');

  // Get the user's lstBCH NFT UTXO
  console.log('\n📥 Fetching lstBCH NFT UTXO...');
  
  try {
    // Get UTXOs at the owner's address to find the lstBCH NFT
    const userUtxos = await provider.getUtxos(ownerAddress);
    
    // Find the NFT from the stake transaction
    const nftUtxo = userUtxos.find(u => 
      u.txid === nftTxId && 
      u.vout === nftVout &&
      u.token?.category === mintingUtxo.token?.category &&
      u.token?.nft?.capability === 'none' // Receipt NFT has no capability
    );

    if (!nftUtxo) {
      console.error('❌ lstBCH NFT not found at', nftTxId, ':', nftVout);
      console.error('   Make sure:');
      console.error('   1. The transaction ID is correct');
      console.error('   2. You still own the NFT (not spent)');
      console.error('   3. The NFT is at vout', nftVout);
      
      // List user's NFT UTXOs for debugging
      const nftUtxos = userUtxos.filter(u => u.token?.nft);
      if (nftUtxos.length > 0) {
        console.error('\n   Your NFT UTXOs:');
        nftUtxos.forEach((u, i) => {
          console.error(`   [${i}] ${u.txid}:${u.vout}`);
          console.error('       Category:', u.token?.category);
          console.error('       Commitment:', u.token?.nft?.commitment);
          console.error('       Capability:', u.token?.nft?.capability);
        });
      }
      
      process.exit(1);
    }

    // Decode the stake amount from NFT commitment
    const commitment = nftUtxo.token?.nft?.commitment || '';
    const stakedAmount = BigInt('0x' + commitment);
    
    console.log('✅ Found lstBCH NFT!');
    console.log('   TXID:', nftUtxo.txid, ':', nftUtxo.vout);
    console.log('   Staked amount:', Number(stakedAmount), 'sats');
    console.log('   Commitment (hex):', commitment);

    // Check contract has enough balance
    if (Number(mintingUtxo.satoshis) < Number(stakedAmount)) {
      console.error('❌ Contract does not have enough BCH to unstake!');
      console.error('   Contract balance:', Number(mintingUtxo.satoshis), 'sats');
      console.error('   Requested:', Number(stakedAmount), 'sats');
      process.exit(1);
    }

    console.log('\n📝 Building unstake transaction...');
    console.log('   Returning:', Number(stakedAmount), 'sats + yield to', ownerAddress);

    // Build and send the unstake transaction
    // @ts-ignore - CashScript types may be outdated
    const tx = await contract.functions.unstake()
      .from({
        txid: nftUtxo.txid,
        vout: nftUtxo.vout,
        value: nftUtxo.satoshis,
        token: {
          category: nftUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: commitment }
        }
      })
      .to([
        {
          to: contract.tokenAddress,
          amount: BigInt(Number(mintingUtxo.satoshis) - Number(stakedAmount)),
          token: {
            category: mintingUtxo.token!.category!,
            amount: 0n,
            nft: { capability: 'minting', commitment: '' }
          }
        },
        {
          to: ownerAddress,
          amount: stakedAmount
          // Note: No token output - this burns the NFT
        }
      ])
      .send();

    console.log('\n✅ Unstake transaction sent!');
    console.log('   TXID:', tx.txid);
    console.log('   You received:', Number(stakedAmount), 'sats');
    console.log('   lstBCH NFT has been burned.');
    
    // Save transaction info
    const unstakeInfo = {
      txid: tx.txid,
      amount: stakedAmount.toString(),
      burnedNftTxid: nftTxId,
      burnedNftVout: nftVout,
      timestamp: new Date().toISOString()
    };
    writeFileSync('unstake-info.json', JSON.stringify(unstakeInfo, null, 2));
    console.log('✅ Saved unstake-info.json');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('UTXO') || error.message.includes('utxo')) {
      console.error('\n💡 Tips:');
      console.error('   - Make sure the NFT still exists and is unspent');
      console.error('   - Check that the contract has enough BCH balance');
    }
  }
}

main().catch(console.error);
