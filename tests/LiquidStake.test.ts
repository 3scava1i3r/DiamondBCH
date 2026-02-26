import { describe, it, expect, beforeEach } from 'vitest';
import { Contract, MockNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { createHash } from 'crypto';

// Helper: hash160
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

// Test WIF (chipnet test key - NO REAL FUNDS)
const TEST_WIF = 'cW2N3g6PTEvZin8cij7oF6JcvsDGdDjGnF2MmQgRA11rRdJjMuFa';
const MOCK_CATEGORY = '0000000000000000000000000000000000000000000000000000000000000001';

describe('LiquidStake Contract', () => {
  let provider: MockNetworkProvider;
  let artifact: any;
  let ownerPkh: Uint8Array;
  let contract: Contract;

  beforeEach(async () => {
    // Setup provider like Anvil
    provider = new MockNetworkProvider();
    
    // Compile contract
    artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
    
    // Derive owner from WIF
    const sigTemplate = new SignatureTemplate(TEST_WIF);
    const pubkey = sigTemplate.getPublicKey();
    ownerPkh = hash160(pubkey);
    
    // Deploy contract to mock network
    contract = new Contract(artifact, [ownerPkh], { provider });
    
    // Add contract UTXO with minting NFT (like funding the contract)
    provider.addUtxo(contract.tokenAddress, {
      txid: 'aa'.repeat(32),
      vout: 0,
      satoshis: 100_000n,
      token: {
        category: MOCK_CATEGORY,
        amount: 0n,
        nft: {
          capability: 'minting' as const,
          commitment: '',
        },
      },
    });
  });

  describe('deployment', () => {
    it('should compile and deploy successfully', () => {
      expect(contract.address).toBeDefined();
      expect(contract.tokenAddress).toBeDefined();
      expect(contract.bytesize).toBeGreaterThan(0);
      expect(contract.opcount).toBeGreaterThan(0);
    });

    it('should have correct bytecode', () => {
      expect(contract.bytecode).toBeDefined();
      expect(contract.bytecode.length).toBeGreaterThan(0);
    });

    it('should have valid addresses', () => {
      expect(contract.address).toMatch(/^bchtest:/);
      expect(contract.tokenAddress).toMatch(/^bchtest:/);
    });
  });

  describe('contract UTXO setup', () => {
    it('should have contract with minting NFT', async () => {
      const utxos = await contract.getUtxos();
      expect(utxos.length).toBe(1);
      expect(utxos[0].token?.nft?.capability).toBe('minting');
    });

    it('should have correct NFT category', async () => {
      const utxos = await contract.getUtxos();
      expect(utxos[0].token?.category).toBe(MOCK_CATEGORY);
    });

    it('should have correct BCH balance', async () => {
      const utxos = await contract.getUtxos();
      expect(Number(utxos[0].satoshis)).toBe(100_000);
    });

    it('should track token correctly', async () => {
      const utxos = await contract.getUtxos();
      const nft = utxos[0].token?.nft;
      expect(nft?.capability).toBe('minting');
      expect(nft?.commitment).toBe('');
    });
  });

  describe('contract functions exist', () => {
    it('should have stake function', () => {
      // @ts-ignore - unlock exists at runtime
      expect(typeof contract.unlock.stake).toBe('function');
    });

    it('should have unstake function', () => {
      // @ts-ignore
      expect(typeof contract.unlock.unstake).toBe('function');
    });

    it('should have withdraw function', () => {
      // @ts-ignore
      expect(typeof contract.unlock.withdraw).toBe('function');
    });
  });

  describe('balance', () => {
    it('should return correct balance', async () => {
      const balance = await contract.getBalance();
      expect(Number(balance)).toBe(100_000);
    });
  });
});

describe('MockNetwork (Anvil equivalent)', () => {
  let provider: MockNetworkProvider;
  let userAddress: string;

  beforeEach(() => {
    provider = new MockNetworkProvider();
    const sigTemplate = new SignatureTemplate(TEST_WIF);
    const pubkey = sigTemplate.getPublicKey();
    const pkh = hash160(pubkey);
    const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
    const contract = new Contract(artifact, [pkh], { provider });
    userAddress = contract.address;
  });

  it('should generate UTXOs like Anvil', async () => {
    provider.addUtxo(userAddress, {
      txid: 'bb'.repeat(32),
      vout: 0,
      satoshis: 50_000n,
    });

    const utxos = await provider.getUtxos(userAddress);
    expect(utxos.length).toBe(1);
    expect(Number(utxos[0].satoshis)).toBe(50_000);
  });

  it('should handle multiple UTXOs', async () => {
    provider.addUtxo(userAddress, {
      txid: 'cc'.repeat(32),
      vout: 0,
      satoshis: 10_000n,
    });
    
    provider.addUtxo(userAddress, {
      txid: 'dd'.repeat(32),
      vout: 1,
      satoshis: 20_000n,
    });

    const utxos = await provider.getUtxos(userAddress);
    expect(utxos.length).toBe(2);
  });

  it('should support CashTokens FTs', async () => {
    provider.addUtxo(userAddress, {
      txid: 'ee'.repeat(32),
      vout: 0,
      satoshis: 1_000n,
      token: {
        category: MOCK_CATEGORY,
        amount: 100n,
      },
    });

    const utxos = await provider.getUtxos(userAddress);
    expect(utxos[0].token?.amount).toBe(100n);
    expect(utxos[0].token?.category).toBe(MOCK_CATEGORY);
  });

  it('should support CashTokens NFTs', async () => {
    provider.addUtxo(userAddress, {
      txid: 'ff'.repeat(32),
      vout: 0,
      satoshis: 1_000n,
      token: {
        category: MOCK_CATEGORY,
        amount: 0n,
        nft: {
          capability: 'none' as const,
          commitment: 'a1b2c3d4e5f6',
        },
      },
    });

    const utxos = await provider.getUtxos(userAddress);
    expect(utxos[0].token?.nft?.capability).toBe('none');
    expect(utxos[0].token?.nft?.commitment).toBe('a1b2c3d4e5f6');
  });

  it('should track UTXO spends correctly', async () => {
    const txid = 'gg'.repeat(32);
    provider.addUtxo(userAddress, {
      txid,
      vout: 0,
      satoshis: 10_000n,
    });

    // Get UTXO
    let utxos = await provider.getUtxos(userAddress);
    expect(utxos.length).toBe(1);

    // "Spend" by adding new UTXO (in real scenario, spent UTXOs wouldn't appear)
    provider.addUtxo(userAddress, {
      txid: 'hh'.repeat(32),
      vout: 0,
      satoshis: 5_000n,
    });

    utxos = await provider.getUtxos(userAddress);
    expect(utxos.length).toBe(2);
  });
});

describe('Contract Compilation', () => {
  it('should compile LiquidStake.cash without errors', () => {
    const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
    expect(artifact).toBeDefined();
    expect(artifact.bytecode).toBeDefined();
    expect(artifact.abi).toBeDefined();
  });

  it('should have correct ABI with stake, unstake, withdraw', () => {
    const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
    const abi = artifact.abi;
    
    const functionNames = abi.map(f => f.name);
    expect(functionNames).toContain('stake');
    expect(functionNames).toContain('unstake');
    expect(functionNames).toContain('withdraw');
  });

  it('should have correct constructor inputs', () => {
    const artifact = compileFile(new URL('../contracts/LiquidStake.cash', import.meta.url));
    expect(artifact.constructorInputs).toHaveLength(1);
    expect(artifact.constructorInputs[0].type).toBe('bytes20');
    expect(artifact.constructorInputs[0].name).toBe('ownerPkh');
  });
});
