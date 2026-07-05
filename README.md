# NoxVault

**A private yield vault built on iExec Nox — encrypted balances, confidential transfers, and on-chain yield, powered by Fully Homomorphic Encryption.**

NoxVault is a DeFi application where user deposit amounts and balances are encrypted on-chain using the [iExec Nox protocol](https://iex.ec). Nobody — not block explorers, not other users, not the contract itself — can read your position in plaintext. You deposit USDC, it earns yield through a strategy, and you withdraw your principal plus your share of the returns. All while your balance stays invisible.

Built as part of the **iExec Vibe Coding Challenge** — an AI-assisted rapid prototype demonstrating confidential and programmable financial logic on Nox.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Deployed Contracts](#deployed-contracts)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Frontend](#running-the-frontend)
- [Deploying Contracts](#deploying-contracts)
- [Usage Guide](#usage-guide)
- [Smart Contract Reference](#smart-contract-reference)
- [Project Structure](#project-structure)
- [License](#license)

---

## How It Works

1. **Deposit** — You approve and deposit USDC into the vault. Your balance is immediately encrypted on-chain as a `euint256` (an FHE-encrypted integer) via Nox. On-chain observers see only an opaque handle — never a balance.

2. **Yield accrual** — The vault manager deploys funds to a yield strategy (currently a mock at 5% APY). Yield accrues proportionally to your deposit share.

3. **Withdraw** — You withdraw your principal plus your proportional share of yield (90% of total yield; 10% goes to the manager as a performance fee). The vault auto-recalls from the strategy if reserves are insufficient.

4. **Wrap** — Separately, you can wrap any USDC into `cUSDC` (the iExec Confidential Token), an ERC-20 wrapper with hidden balances. You can also send confidential transfers to any address — the amount is encrypted on-chain and invisible to observers.

---

## Architecture

```
vault-frontend/          # React + Vite frontend (TypeScript)
confidential-vault/      # Hardhat smart contracts
  contracts/
    ConfidentialVault.sol    # Main vault — FHE-encrypted balances via Nox
    MockYieldStrategy.sol    # Simulated yield strategy (5% APY)
  ignition/modules/
    deploy.ts                # Hardhat Ignition deployment module
  scripts/
    deploy.ts                # Manual deploy script via viem
  hardhat.config.ts
```

### Key design choices

- **`euint256` encrypted balances** — user balances are stored as Nox FHE ciphertexts. `Nox.add()` and `Nox.sub()` perform arithmetic on encrypted values without ever decrypting on-chain.
- **`Nox.allow()` access control** — after every balance update, the contract grants the user permission to decrypt their own balance off-chain.
- **Auto-recall from strategy** — withdrawals automatically pull from the yield strategy if the vault's direct reserve is insufficient, so users never need to wait for a manager action.
- **Confidential Token (cUSDC)** — USDC is wrapped using iExec's `ConfidentialToken` contract, making transfers invisible to on-chain observers.

---

## Deployed Contracts

All contracts are deployed on **Arbitrum Sepolia** (testnet, chain ID `421614`).

| Contract | Address |
|---|---|
| ConfidentialVault | `0x5ae401f71890d92b577ef19a9210f4ddddd0f2a9` |
| MockYieldStrategy | `0x898f954c63f5677ff3e12b96f9fd5725e3e27591` |
| USDC (testnet) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| cUSDC (Confidential Token) | `0x1CCeC6bC60dB15E4055D43Dc2531BB7D4E5B808e` |

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/) v9 or later
- [MetaMask](https://metamask.io/) browser extension
- An Arbitrum Sepolia wallet with testnet ETH (for gas) and testnet USDC

To get testnet ETH on Arbitrum Sepolia, use the [Arbitrum bridge](https://bridge.arbitrum.io/) or a faucet such as [https://faucet.quicknode.com/arbitrum/sepolia](https://faucet.quicknode.com/arbitrum/sepolia).

To get testnet USDC, use the [Circle USDC faucet](https://faucet.circle.com/) and select Arbitrum Sepolia.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/noxvault.git
cd noxvault
```

Install dependencies for both packages:

```bash
# Smart contracts
cd confidential-vault
npm install

# Frontend
cd ../vault-frontend
npm install
```

---

## Running the Frontend

From the `vault-frontend` directory:

```bash
npm run dev
```

This starts a local development server, typically at `http://localhost:5173`.

Open it in your browser, connect MetaMask, and switch to the **Arbitrum Sepolia** network (chain ID `421614`). The frontend connects to the already-deployed contracts listed above — no local node is needed.

To build for production:

```bash
npm run build
```

The output will be in `vault-frontend/dist/`.

---

## Deploying Contracts

If you want to deploy your own instance of the contracts:

### 1. Set your private key

```bash
export PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

> **Never commit your private key.** Use environment variables or a `.env` file (add `.env` to `.gitignore`).

### 2. Deploy using Hardhat Ignition (recommended)

From the `confidential-vault` directory:

```bash
npx hardhat ignition deploy ignition/modules/deploy.ts --network arbitrumSepolia
```

This deploys `ConfidentialVault` and `MockYieldStrategy` in a single transaction sequence and prints the deployed addresses.

### 3. Deploy using the manual script (alternative)

```bash
npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

### 4. Update the frontend

After deploying, open `vault-frontend/src/App.tsx` and update the contract addresses at the top of the file:

```typescript
const VAULT_ADDRESS    = "0xYOUR_VAULT_ADDRESS";
const STRATEGY_ADDRESS = "0xYOUR_STRATEGY_ADDRESS";
```

---

## Usage Guide

### Vault tab — Deposit and withdraw

1. Connect your MetaMask wallet on Arbitrum Sepolia.
2. Enter an amount and click **Deposit**. This will:
   - Prompt MetaMask to approve USDC spending.
   - Prompt MetaMask to call `deposit()` on the vault.
   - Encrypt your balance on-chain using Nox FHE.
3. Your **encrypted handle** appears on the card — this is the on-chain ciphertext of your balance.
4. **Yield earned** updates as the strategy accrues returns.
5. To withdraw, enter an amount and click **Withdraw**. You receive your principal plus your proportional yield share.

### Wrap tab — Confidential Token

1. Enter an amount and click **Wrap to cUSDC**. This converts public USDC into `cUSDC` — an ERC-20 with a hidden balance.
2. Use **Send Confidentially** to transfer cUSDC to any address. The amount is encrypted on-chain and invisible to block explorers.
3. To unwrap cUSDC back to USDC, visit [cdefi.iex.ec](https://cdefi.iex.ec) — this requires the two-step TEE decryption proof that iExec's app handles.

### Manager tab (vault owner only)

The manager tab is only visible when connected with the owner wallet. From here you can:

- **Deploy** — move USDC from the vault reserve into the yield strategy.
- **Recall** — pull USDC back from the strategy into the vault.
- **Collect fee** — claim the 10% performance fee on accrued yield.

---

## Smart Contract Reference

### ConfidentialVault.sol

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 amount)` | Public | Deposit USDC; balance encrypted via Nox |
| `withdraw(uint256 amount)` | Public | Withdraw principal + proportional yield |
| `encryptedBalanceOf(address)` | View | Returns the FHE handle for a user's balance |
| `previewYield(address)` | View | Returns the current accrued yield for a user |
| `previewWithdraw(address, uint256)` | View | Returns total receivable on a withdrawal |
| `deployToStrategy(address, uint256)` | Owner | Move funds to a yield strategy |
| `recallFromStrategy(uint256)` | Owner | Pull funds back from the strategy |
| `collectManagerFee()` | Owner | Claim the 10% performance fee |
| `totalAssets()` | View | Combined vault reserve + strategy balance |

**Performance fee:** 10% of all accrued yield goes to the vault owner. The remaining 90% is distributed proportionally to depositors based on their share of total deposits.

**Reentrancy protection:** All state-mutating functions use a manual reentrancy guard (`_status` flag).

### MockYieldStrategy.sol

A simulated yield strategy that accrues 5% APY on deposited USDC. This is a test/demo contract — in production it would be replaced with a real protocol integration (e.g. Aave, Compound).

| Function | Access | Description |
|---|---|---|
| `deposit(uint256)` | Vault only | Receive USDC from the vault |
| `withdraw(uint256)` | Vault only | Return USDC to the vault |
| `totalAssets()` | View | Deposited amount + accrued yield |
| `accruedYield()` | View | Yield accrued since last update |

---

## Project Structure

```
noxvault/
├── confidential-vault/
│   ├── contracts/
│   │   ├── ConfidentialVault.sol
│   │   └── MockYieldStrategy.sol
│   ├── ignition/
│   │   └── modules/
│   │       └── deploy.ts
│   ├── scripts/
│   │   └── deploy.ts
│   ├── hardhat.config.ts
│   ├── tsconfig.json
│   └── package.json
└── vault-frontend/
    ├── src/
    │   ├── App.tsx          # Main application component
    │   ├── App.css
    │   ├── main.jsx
    │   └── index.css
    ├── public/
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## License

MIT — see [LICENSE](./LICENSE) for details.

---

*Built with [iExec Nox](https://iex.ec), [Hardhat](https://hardhat.org/), [React](https://react.dev/), and [viem](https://viem.sh/) on [Arbitrum Sepolia](https://arbitrum.io/).*
