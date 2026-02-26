import { Contract, ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { compileFile } from 'cashc';
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

// Helper: hash160
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

/*
 * Deploy LiquidStake contract to chipnet.
 *
 * Steps:
 *   1. Compile the contract
 *   2. Instantiate with owner's PKH
 *   3. Fund the contract address (manually via faucet, or from wallet)
 *   4. Create genesis tx that puts a minting NFT into the contract
 *
 * Usage:
 *   OWNER_WIF=<your-chipnet-wif> npx tsx src/deploy.ts
 *
 * Get a chipnet WIF:
 *   1. Install Electron Cash (cashtokens edition)
 *   2. Switch to chipnet: Tools → Network → Chipnet
 *   3. Get coins: https://faucet.chipnet.cash
 *   4. Export WIF: Tools → Private Keys
 */

async function main() {
  const ownerWif = process.env.OWNER_WIF;
  if (!ownerWif) {
    console.error('❌ Set OWNER_WIF env var to your chipnet private key (WIF format)');
    console.error('   OWNER_WIF=cNk... npx tsx src/deploy.ts');
    process.exit(1);
  }

  // 1. Compile
  const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
  writeFileSync('LiquidStake.json', JSON.stringify(artifact, null, 2));
  console.log('✅ Compiled LiquidStake.cash');

  // 2. Derive owner PKH from WIF
  const provider = new ElectrumNetworkProvider('chipnet');
  const sigTemplate = new SignatureTemplate(ownerWif);

  // 3. Compute owner PKH (hash160 of pubkey)
  const pubkey = sigTemplate.getPublicKey();
  const ownerPkhBytes = hash160(pubkey);

  // 3. Instantiate the contract
  const contract = new Contract(artifact, [ownerPkhBytes], { provider });

  console.log('📍 Contract address:', contract.address);
  console.log('📍 Token address:  ', contract.tokenAddress);
  console.log('📏 Bytecode size:  ', contract.bytesize, 'bytes');
  console.log('📏 Opcount:        ', contract.opcount);

  const balance = await contract.getBalance();
  console.log('💰 Balance:        ', balance, 'sats');

  // Save deployment info
  const deployInfo = {
    address: contract.address,
    tokenAddress: contract.tokenAddress,
    bytesize: contract.bytesize,
    opcount: contract.opcount,
    ownerPkh: Buffer.from(ownerPkhBytes).toString('hex'),
  };
  writeFileSync('deploy-info.json', JSON.stringify(deployInfo, null, 2));
  console.log('✅ Saved deploy-info.json');

  console.log('\n📋 Next steps:');
  console.log('   1. Send chipnet BCH to the contract\'s token address:');
  console.log('      ', contract.tokenAddress);
  console.log('   2. Create a genesis TX to mint the category (minting NFT)');
  console.log('      This requires spending a UTXO to create the token category.');
  console.log('   3. Run: OWNER_WIF=... npx tsx src/stake.ts');
  
  // Note: Don't call provider.disconnect() - ElectrumNetworkProvider in cashscript 0.12+
  // handles connection management automatically and will throw if manually disconnected
}

main().catch(console.error);
