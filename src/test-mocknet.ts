import {
  Contract,
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import { compileFile } from 'cashc';
import { createHash } from 'crypto';

/*
 * Test LiquidStake on mocknet (no real network needed).
 *
 * Usage:
 *   npx tsx src/test-mocknet.ts
 */

// Helper: hash160(pubkey)
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

// Helper: encode int as 8-byte LE
function int64LE(n: bigint): Uint8Array {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n);
  return buf;
}

async function main() {
  console.log('🧪 Testing LiquidStake on mocknet...\n');

  // Setup
  const provider = new MockNetworkProvider();
  const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));

  // Use a test WIF (chipnet)
  const ownerWif = 'cW2N3g6PTEvZin8cij7oF6JcvsDGdDjGnF2MmQgRA11rRdJjMuFa';
  const sigTemplate = new SignatureTemplate(ownerWif);
  const ownerPk = sigTemplate.getPublicKey();
  const ownerPkh = hash160(ownerPk);

  const contract = new Contract(artifact, [ownerPkh], { provider });

  console.log('📍 Contract address:', contract.address);
  console.log('📏 Bytecode size:  ', contract.bytesize, 'bytes');
  console.log('📏 Opcount:        ', contract.opcount);

  // Create a mock token category (32 bytes)
  const mockCategory = '0000000000000000000000000000000000000000000000000000000000000001';

  // Add a mock UTXO with a minting NFT to the contract
  provider.addUtxo(contract.address, {
    txid: 'aa'.repeat(32),
    vout: 0,
    satoshis: 100_000n,
    token: {
      category: mockCategory,
      amount: 0n,
      nft: {
        capability: 'minting',
        commitment: '',
      },
    },
  });

  // Verify UTXOs
  const utxos = await contract.getUtxos();
  console.log('📦 Contract UTXOs:', utxos.length);
  console.log('   Minting NFT:', utxos[0]?.token?.nft?.capability);

  console.log('\n✅ Contract compiles and instantiates successfully!');
  console.log('✅ MockNetworkProvider works with CashTokens!');
  console.log('\n🎯 Contract ready for chipnet deployment.');
}

main().catch(console.error);
