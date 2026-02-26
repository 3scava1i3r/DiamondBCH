import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import bs58check from 'bs58check';

/*
 * YieldSplitFacet - Split lstBCH into PT + YT, Merge, Redeem, Claim
 *
 * Prerequisites:
 *   - lstBCH NFT from LiquidStake contract
 *   - Contract deployed (via deploy-yield-split.ts)
 *
 * Usage:
 *   Split:   OWNER_WIF=<wif> NFT_TXID=<txid> NFT_VOUT=<vout> EXPIRY=500000 npx tsx src/yield-split.ts --action split
 *   Merge:   OWNER_WIF=<wif> PT_TXID=<txid> PT_VOUT=<vout> YT_TXID=<txid> YT_VOUT=<vout> npx tsx src/yield-split.ts --action merge
 *   Redeem:  OWNER_WIF=<wif> PT_TXID=<txid> PT_VOUT=<vout> npx tsx src/yield-split.ts --action redeem
 *   Claim:   OWNER_WIF=<wif> YT_TXID=<txid> YT_VOUT=<vout> npx tsx src/yield-split.ts --action claim
 */

// Helper: hash160
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

// Helper: Encode PKH to Cash Address
function pkhToCashAddress(pkh: Uint8Array, network: 'bchtest' | 'bchreg' = 'bchtest'): string {
  const version = 0x00;
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(pkh)]);
  const address = bs58check.encode(payload);
  return `${network}:${address}`;
}

// Helper: Parse PT/YT commitment
function parsePTCommitment(commitment: string): { principal: bigint; expiry: number } {
  const principal = BigInt('0x' + commitment.slice(0, 16)); // 8 bytes
  const expiry = parseInt(commitment.slice(16, 24), 16); // 4 bytes
  return { principal, expiry };
}

function parseYTCommitment(commitment: string): { yieldAccrued: bigint; expiry: number } {
  const yieldAccrued = BigInt('0x' + commitment.slice(0, 16)); // 8 bytes
  const expiry = parseInt(commitment.slice(16, 24), 16); // 4 bytes
  return { yieldAccrued, expiry };
}

// Helper: Build PT commitment (principal + expiry) - Big-endian for CashScript
function buildPTCommitment(principal: bigint, expiry: number): string {
  const principalBytes = Buffer.alloc(8);
  principalBytes.writeBigUInt64BE(principal);
  const expiryBytes = Buffer.alloc(4);
  expiryBytes.writeUInt32BE(expiry);
  return principalBytes.toString('hex') + expiryBytes.toString('hex');
}

// Helper: Build YT commitment (yieldAccrued + expiry) - Big-endian for CashScript
function buildYTCommitment(yieldAccrued: bigint, expiry: number): string {
  const yieldBytes = Buffer.alloc(8);
  yieldBytes.writeBigUInt64BE(yieldAccrued);
  const expiryBytes = Buffer.alloc(4);
  expiryBytes.writeUInt32BE(expiry);
  return yieldBytes.toString('hex') + expiryBytes.toString('hex');
}

async function main() {
  const action = process.env.ACTION || process.argv[2]?.replace('--action=', '') || 'split';
  const ownerWif = process.env.OWNER_WIF;
  
  if (!ownerWif) {
    console.error('❌ Set OWNER_WIF env var');
    console.error('\nUsage:');
    console.error('  Split:  OWNER_WIF=<wif> NFT_TXID=<txid> NFT_VOUT=<vout> EXPIRY=500000 npx tsx src/yield-split.ts --action split');
    console.error('  Merge:  OWNER_WIF=<wif> PT_TXID=<txid> PT_VOUT=<vout> YT_TXID=<txid> YT_VOUT=<vout> npx tsx src/yield-split.ts --action merge');
    console.error('  Redeem: OWNER_WIF=<wif> PT_TXID=<txid> PT_VOUT=<vout> npx tsx src/yield-split.ts --action redeem');
    console.error('  Claim:  OWNER_WIF=<wif> YT_TXID=<txid> YT_VOUT=<vout> npx tsx src/yield-split.ts --action claim');
    process.exit(1);
  }

  console.log(`⚡ YieldSplitFacet - Action: ${action}`);
  console.log('='.repeat(50));

  const provider = new ElectrumNetworkProvider('chipnet');
  const sigTemplate = new SignatureTemplate(ownerWif);

  // Derive owner PKH and address
  const pubkey = sigTemplate.getPublicKey();
  const ownerPkh = hash160(pubkey);
  const ownerAddress = pkhToCashAddress(ownerPkh, 'bchtest');

  console.log('👤 Owner address:', ownerAddress);

  // Compile & instantiate YieldSplitFacet
  const artifact = compileFile(new URL('../contracts/YieldSplitFacet.cash', import.meta.url));
  
  // Use a placeholder hub PKH for now (in production, this would be the DeFiHub address)
  const hubPkh = ownerPkh;
  const contract = new Contract(artifact, [hubPkh], { provider });

  console.log('📍 Contract address:', contract.address);
  console.log('📍 Token address:   ', contract.tokenAddress);

  try {
    switch (action) {
      case 'split':
        await handleSplit(provider, contract, ownerAddress);
        break;
      case 'merge':
        await handleMerge(provider, contract, ownerAddress);
        break;
      case 'redeem':
        await handleRedeemPT(provider, contract, ownerAddress);
        break;
      case 'claim':
        await handleClaimYield(provider, contract, ownerAddress);
        break;
      default:
        console.error('❌ Unknown action:', action);
        console.error('   Valid actions: split, merge, redeem, claim');
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('UTXO') || error.message.includes('utxo')) {
      console.error('\n💡 Tips:');
      console.error('   - Make sure the NFT UTXO still exists and is unspent');
      console.error('   - Check that you have the correct transaction ID and vout');
    }
  }
}

async function handleSplit(provider: ElectrumNetworkProvider, contract: Contract, ownerAddress: string) {
  const nftTxId = process.env.NFT_TXID;
  const nftVout = parseInt(process.env.NFT_VOUT ?? '1');
  const expiry = parseInt(process.env.EXPIRY ?? '500000');

  if (!nftTxId) {
    console.error('❌ Set NFT_TXID env var (the lstBCH NFT from staking)');
    console.error('   Example: NFT_TXID=abc123... NFT_VOUT=1 EXPIRY=500000 npx tsx src/yield-split.ts --action split');
    process.exit(1);
  }

  console.log(`\n📥 Splitting lstBCH NFT: ${nftTxId}:${nftVout}`);
  console.log(`   Expiry: ${expiry}`);

  // Get user's lstBCH NFT UTXO
  const userUtxos = await provider.getUtxos(ownerAddress);
  
  const nftUtxo = userUtxos.find(u => 
    u.txid === nftTxId && 
    u.vout === nftVout &&
    u.token?.nft?.capability === 'none'
  );

  if (!nftUtxo) {
    console.error('❌ lstBCH NFT not found at', nftTxId, ':', nftVout);
    process.exit(1);
  }

  // Parse principal from lstBCH commitment
  const commitment = nftUtxo.token?.nft?.commitment || '';
  const principal = BigInt('0x' + commitment);

  console.log('✅ Found lstBCH NFT!');
  console.log('   Principal:', Number(principal), 'sats');

  // Build PT and YT commitments (big-endian)
  const ptCommitment = buildPTCommitment(principal, expiry);
  const ytCommitment = buildYTCommitment(0n, expiry);

  console.log('\n📝 Building split transaction...');
  console.log('   PT commitment:', ptCommitment);
  console.log('   YT commitment:', ytCommitment);

  // Build split transaction
  // @ts-ignore - CashScript types
  const tx = await contract.functions.split(expiry)
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
        to: ownerAddress,
        amount: 1000n,
        token: {
          category: nftUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: ptCommitment }
        }
      },
      {
        to: ownerAddress,
        amount: 1000n,
        token: {
          category: nftUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: ytCommitment }
        }
      }
    ])
    .send();

  console.log('\n✅ Split transaction sent!');
  console.log('   TXID:', tx.txid);
  console.log('   PT NFT at:  vout 0');
  console.log('   YT NFT at:  vout 1');
  console.log('\n💡 To merge back:');
  console.log('   OWNER_WIF=<wif> PT_TXID=' + tx.txid + ' PT_VOUT=0 YT_TXID=' + tx.txid + ' YT_VOUT=1 npx tsx src/yield-split.ts --action merge');
  console.log('\n💡 To redeem PT at expiry:');
  console.log('   OWNER_WIF=<wif> PT_TXID=' + tx.txid + ' PT_VOUT=0 npx tsx src/yield-split.ts --action redeem');
  console.log('\n💡 To claim YT yield:');
  console.log('   OWNER_WIF=<wif> YT_TXID=' + tx.txid + ' YT_VOUT=1 npx tsx src/yield-split.ts --action claim');

  // Save info
  const splitInfo = {
    txid: tx.txid,
    ptVout: 0,
    ytVout: 1,
    principal: principal.toString(),
    expiry: expiry,
    timestamp: new Date().toISOString()
  };
  writeFileSync('split-info.json', JSON.stringify(splitInfo, null, 2));
  console.log('✅ Saved split-info.json');
}

async function handleMerge(provider: ElectrumNetworkProvider, contract: Contract, ownerAddress: string) {
  const ptTxId = process.env.PT_TXID;
  const ptVout = parseInt(process.env.PT_VOUT ?? '0');
  const ytTxId = process.env.YT_TXID;
  const ytVout = parseInt(process.env.YT_VOUT ?? '1');

  if (!ptTxId || !ytTxId) {
    console.error('❌ Set PT_TXID and YT_TXID env vars');
    console.error('   Example: PT_TXID=abc... PT_VOUT=0 YT_TXID=def... YT_VOUT=1 npx tsx src/yield-split.ts --action merge');
    process.exit(1);
  }

  console.log(`\n📥 Merging PT + YT:`);
  console.log(`   PT: ${ptTxId}:${ptVout}`);
  console.log(`   YT: ${ytTxId}:${ytVout}`);

  // Get user's PT and YT NFT UTXOs
  const userUtxos = await provider.getUtxos(ownerAddress);
  
  const ptUtxo = userUtxos.find(u => 
    u.txid === ptTxId && u.vout === ptVout && u.token?.nft?.capability === 'none'
  );
  const ytUtxo = userUtxos.find(u => 
    u.txid === ytTxId && u.vout === ytVout && u.token?.nft?.capability === 'none'
  );

  if (!ptUtxo || !ytUtxo) {
    console.error('❌ PT or YT NFT not found');
    if (!ptUtxo) console.error('   PT not found at', ptTxId, ':', ptVout);
    if (!ytUtxo) console.error('   YT not found at', ytTxId, ':', ytVout);
    process.exit(1);
  }

  // Parse commitments
  const ptData = parsePTCommitment(ptUtxo.token?.nft?.commitment || '');
  const ytData = parseYTCommitment(ytUtxo.token?.nft?.commitment || '');

  console.log('✅ Found PT and YT NFTs!');
  console.log('   PT Principal:', Number(ptData.principal), 'sats, Expiry:', ptData.expiry);
  console.log('   YT Yield:', Number(ytData.yieldAccrued), 'sats, Expiry:', ytData.expiry);

  // Build lstBCH commitment (big-endian, just principal)
  const lstBchCommitment = Buffer.alloc(8);
lstBchCommitment.writeBigUInt64BE(ptData.principal);

  console.log('\n📝 Building merge transaction...');

  // Build merge transaction
  // @ts-ignore - CashScript types
  const tx = await contract.functions.merge()
    .from([
      {
        txid: ptUtxo.txid,
        vout: ptUtxo.vout,
        value: ptUtxo.satoshis,
        token: {
          category: ptUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: ptUtxo.token!.nft!.commitment! }
        }
      },
      {
        txid: ytUtxo.txid,
        vout: ytUtxo.vout,
        value: ytUtxo.satoshis,
        token: {
          category: ytUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: ytUtxo.token!.nft!.commitment! }
        }
      }
    ])
    .to([
      {
        to: ownerAddress,
        amount: 1000n,
        token: {
          category: ptUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: lstBchCommitment.toString('hex') }
        }
      }
    ])
    .send();

  console.log('\n✅ Merge transaction sent!');
  console.log('   TXID:', tx.txid);
  console.log('   lstBCH NFT at: vout 0');
  console.log('   PT and YT have been burned');
  console.log('\n💡 To unstake for BCH:');
  console.log('   OWNER_WIF=<wif> NFT_TXID=' + tx.txid + ' NFT_VOUT=0 npx tsx src/unstake.ts');
}

async function handleRedeemPT(provider: ElectrumNetworkProvider, contract: Contract, ownerAddress: string) {
  const ptTxId = process.env.PT_TXID;
  const ptVout = parseInt(process.env.PT_VOUT ?? '0');
  const currentTime = parseInt(process.env.CURRENT_TIME ?? '500001');

  if (!ptTxId) {
    console.error('❌ Set PT_TXID env var');
    console.error('   Example: PT_TXID=abc... PT_VOUT=0 CURRENT_TIME=500001 npx tsx src/yield-split.ts --action redeem');
    process.exit(1);
  }

  console.log(`\n📥 Redeeming PT: ${ptTxId}:${ptVout}`);
  console.log(`   Current time: ${currentTime}`);

  // Get user's PT NFT UTXO
  const userUtxos = await provider.getUtxos(ownerAddress);
  
  const ptUtxo = userUtxos.find(u => 
    u.txid === ptTxId && u.vout === ptVout && u.token?.nft?.capability === 'none'
  );

  if (!ptUtxo) {
    console.error('❌ PT NFT not found at', ptTxId, ':', ptVout);
    process.exit(1);
  }

  // Parse PT commitment
  const ptData = parsePTCommitment(ptUtxo.token?.nft?.commitment || '');

  console.log('✅ Found PT NFT!');
  console.log('   Principal:', Number(ptData.principal), 'sats');
  console.log('   Expiry:', ptData.expiry);

  if (currentTime < ptData.expiry) {
    console.error('❌ Cannot redeem yet! Expiry is', ptData.expiry, 'but current time is', currentTime);
    process.exit(1);
  }

  console.log('\n📝 Building redeem transaction...');

  // Build redeem transaction
  // @ts-ignore - CashScript types
  const tx = await contract.functions.redeemPT(currentTime)
    .from({
      txid: ptUtxo.txid,
      vout: ptUtxo.vout,
      value: ptUtxo.satoshis,
      token: {
        category: ptUtxo.token!.category!,
        amount: 0n,
        nft: { capability: 'none', commitment: ptUtxo.token!.nft!.commitment! }
      }
    })
    .to([
      {
        to: ownerAddress,
        amount: ptData.principal
        // No token output - burns the PT NFT
      }
    ])
    .send();

  console.log('\n✅ Redeem transaction sent!');
  console.log('   TXID:', tx.txid);
  console.log('   Received:', Number(ptData.principal), 'sats');
  console.log('   PT NFT has been burned');
}

async function handleClaimYield(provider: ElectrumNetworkProvider, contract: Contract, ownerAddress: string) {
  const ytTxId = process.env.YT_TXID;
  const ytVout = parseInt(process.env.YT_VOUT ?? '1');
  const currentTime = parseInt(process.env.CURRENT_TIME ?? '250000');
  const yieldRate = parseInt(process.env.YIELD_RATE ?? '500'); // 5% default

  if (!ytTxId) {
    console.error('❌ Set YT_TXID env var');
    console.error('   Example: YT_TXID=abc... YT_VOUT=1 CURRENT_TIME=250000 YIELD_RATE=500 npx tsx src/yield-split.ts --action claim');
    process.exit(1);
  }

  console.log(`\n📥 Claiming YT yield: ${ytTxId}:${ytVout}`);
  console.log(`   Current time: ${currentTime}`);
  console.log(`   Yield rate: ${yieldRate/100}% APY`);

  // Get user's YT NFT UTXO
  const userUtxos = await provider.getUtxos(ownerAddress);
  
  const ytUtxo = userUtxos.find(u => 
    u.txid === ytTxId && u.vout === ytVout && u.token?.nft?.capability === 'none'
  );

  if (!ytUtxo) {
    console.error('❌ YT NFT not found at', ytTxId, ':', ytVout);
    process.exit(1);
  }

  // Parse YT commitment
  const ytData = parseYTCommitment(ytUtxo.token?.nft?.commitment || '');

  console.log('✅ Found YT NFT!');
  console.log('   Yield accrued:', Number(ytData.yieldAccrued), 'sats');
  console.log('   Expiry:', ytData.expiry);

  if (currentTime >= ytData.expiry) {
    // After expiry: claim all yield as BCH, burn YT
    console.log('\n📝 Claiming yield after expiry (burning YT)...');
    
    // @ts-ignore - CashScript types
    const tx = await contract.functions.claimYield(currentTime, yieldRate)
      .from({
        txid: ytUtxo.txid,
        vout: ytUtxo.vout,
        value: ytUtxo.satoshis,
        token: {
          category: ytUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: ytUtxo.token!.nft!.commitment! }
        }
      })
      .to([
        {
          to: ownerAddress,
          amount: ytData.yieldAccrued
          // No token output - burns the YT NFT
        }
      ])
      .send();

    console.log('\n✅ Claim transaction sent!');
    console.log('   TXID:', tx.txid);
    console.log('   Received yield:', Number(ytData.yieldAccrued), 'sats');
    console.log('   YT NFT has been burned');
  } else {
    // Before expiry: update YT with new yield
    console.log('\n📝 Claiming partial yield (updating YT)...');
    
    // Calculate new yield (simplified)
    const elapsed = currentTime;
    const newYieldAccrued = ytData.yieldAccrued + BigInt(Number(elapsed) * yieldRate / 10000);
    const newYtCommitment = buildYTCommitment(newYieldAccrued, ytData.expiry);

    // @ts-ignore - CashScript types
    const tx = await contract.functions.claimYield(currentTime, yieldRate)
      .from({
        txid: ytUtxo.txid,
        vout: ytUtxo.vout,
        value: ytUtxo.satoshis,
        token: {
          category: ytUtxo.token!.category!,
          amount: 0n,
          nft: { capability: 'none', commitment: ytUtxo.token!.nft!.commitment! }
        }
      })
      .to([
        {
          to: ownerAddress,
          amount: 1000n,
          token: {
            category: ytUtxo.token!.category!,
            amount: 0n,
            nft: { capability: 'none', commitment: newYtCommitment }
          }
        }
      ])
      .send();

    console.log('\n✅ Claim transaction sent!');
    console.log('   TXID:', tx.txid);
    console.log('   New yield accrued:', Number(newYieldAccrued), 'sats');
    console.log('   YT NFT updated (claim again later)');
  }
}

main().catch(console.error);
