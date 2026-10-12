//! Stateless, fixed-recipient 25 bps Pump/PumpSwap CPI wrapper.
//! No custody, stored balances, admin instructions or arbitrary CPI targets.
#![allow(deprecated)]
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, set_return_data},
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    system_instruction, system_program,
};

pub const RECIPIENT: Pubkey = pubkey!("54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv");
pub const PUMP: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const AMM: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
const ATA: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
const BAD: ProgramError = ProgramError::Custom(6000);
const STAGE_CHANGED: ProgramError = ProgramError::Custom(6001);
const BAD_DELTA: ProgramError = ProgramError::Custom(6002);
const RENT_CHANGED: ProgramError = ProgramError::Custom(6003);
const BUY_V3: [u8; 8] = [225, 247, 80, 30, 213, 179, 132, 136];
const BUY_V2: [u8; 8] = [184, 23, 238, 97, 103, 197, 211, 61];
const SELL_V3: [u8; 8] = [28, 146, 222, 119, 38, 196, 105, 213];
const SELL_V2: [u8; 8] = [93, 246, 130, 60, 231, 233, 64, 178];
const BUY_AMM: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];
const BUY_EXACT_AMM: [u8; 8] = [194, 171, 28, 70, 104, 77, 91, 47];
const SELL_AMM: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

fn require(ok: bool) -> ProgramResult {
    if ok {
        Ok(())
    } else {
        Err(BAD)
    }
}
fn key_at(accounts: &[AccountInfo], index: usize, key: &Pubkey) -> ProgramResult {
    require(accounts.get(index).is_some_and(|a| a.key == key))
}
fn ata(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN.as_ref(), WSOL.as_ref()], &ATA).0
}
fn word(bytes: &[u8], offset: usize) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(
        bytes
            .get(offset..offset + 8)
            .ok_or(BAD)?
            .try_into()
            .map_err(|_| BAD)?,
    ))
}
pub fn service_fee(gross: u64) -> u64 {
    // 25 / 10,000 = 1 / 400. Divide first to avoid overflow at u64::MAX.
    gross / 400
}
fn token_balance(account: &AccountInfo, authority: &Pubkey) -> Result<u64, ProgramError> {
    require(account.owner == &TOKEN && !account.executable && account.key == &ata(authority))?;
    let data = account.try_borrow_data()?;
    require(
        data.len() == 165
            && data[0..32] == WSOL.to_bytes()
            && data[32..64] == authority.to_bytes()
            && data[108] == 1
            && data[109..113] == [1, 0, 0, 0],
    )?;
    word(&data, 64)
}

// Prefix: user, recipient, curve, mint, quote balance, fee destination,
// system program, token program, trade program; then exact SDK trade accounts.
// Data: version=1, venue (0=curve,1=AMM), action (0=buy,1=sell), account count,
// one signer/writable bitmask per trade account, then the original trade data.
pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    require(data.len() >= 4 && data[0] == 1 && data[1] <= 1 && data[2] <= 1)?;
    let count = data[3] as usize;
    require(
        (17..=40).contains(&count) && accounts.len() == 9 + count && data.len() >= 4 + count + 24,
    )?;
    let native = data[1] == 0;
    let buy = data[2] == 0;
    let flags = &data[4..4 + count];
    let payload = &data[4 + count..];
    let trade = &accounts[9..];
    let user = &accounts[0];
    let recipient = &accounts[1];
    let curve = &accounts[2];
    let mint = &accounts[3];
    let balance = &accounts[4];
    let destination = &accounts[5];
    let target = if native { PUMP } else { AMM };
    require(
        user.is_signer
            && user.is_writable
            && user.owner == &system_program::ID
            && user.data_is_empty()
            && !user.executable
            && user.key != &RECIPIENT,
    )?;
    require(
        recipient.key == &RECIPIENT
            && accounts[6].key == &system_program::ID
            && accounts[6].executable
            && accounts[7].key == &TOKEN
            && accounts[7].executable
            && accounts[8].key == &target
            && accounts[8].executable,
    )?;
    require(balance.is_writable && destination.is_writable)?;
    require(
        curve.owner == &PUMP
            && !curve.executable
            && curve.key
                == &Pubkey::find_program_address(&[b"bonding-curve", mint.key.as_ref()], &PUMP).0,
    )?;
    {
        let bytes = curve.try_borrow_data()?;
        require(bytes.len() >= 49 && bytes[..8] == CURVE_DISCRIMINATOR && bytes[48] <= 1)?;
        if (bytes[48] == 0) != native {
            return Err(STAGE_CHANGED);
        }
    }
    let discriminator: [u8; 8] = payload[..8].try_into().map_err(|_| BAD)?;
    let (user_index, mint_index, quote_index, volume_index, exact_output) =
        match (native, buy, discriminator) {
            (true, true, BUY_V3) => (8, 1, 2, 11, false),
            (true, true, BUY_V2) => (13, 1, 2, 20, true),
            (true, false, SELL_V3) => (8, 1, 2, 11, false),
            (true, false, SELL_V2) => (13, 1, 2, 19, false),
            (false, true, BUY_EXACT_AMM) => (1, 3, 4, 12, false),
            (false, true, BUY_AMM) => (1, 3, 4, 20, true),
            (false, false, SELL_V2) => (1, 3, 4, 12, false),
            (false, false, SELL_AMM) => (1, 3, 4, 0, false),
            _ => return Err(BAD),
        };
    key_at(trade, user_index, user.key)?;
    key_at(trade, mint_index, mint.key)?;
    key_at(trade, quote_index, &WSOL)?;
    require(flags[user_index] & 3 == 3)?;
    let bound = word(payload, if buy && !exact_output { 8 } else { 16 })?;
    require(bound > 0 && word(payload, 8)? > 0)?;
    if native {
        require(
            balance.key == user.key
                && destination.key == &RECIPIENT
                && recipient.owner == &system_program::ID
                && recipient.data_is_empty()
                && !recipient.executable,
        )?;
        key_at(trade, if user_index == 8 { 5 } else { 10 }, curve.key)?;
        let volume =
            Pubkey::find_program_address(&[b"user_volume_accumulator", user.key.as_ref()], &PUMP).0;
        key_at(trade, volume_index, &volume)?;
        // Initialize rent-bearing volume accounts before this wrapper, never as
        // part of the measured trade. Reject upgrades that allocate during CPI.
        require(trade[volume_index].owner == &PUMP && !trade[volume_index].data_is_empty())?;
    } else {
        let creator =
            Pubkey::find_program_address(&[b"pool-authority", mint.key.as_ref()], &PUMP).0;
        let pool = Pubkey::find_program_address(
            &[
                b"pool",
                &[0, 0],
                creator.as_ref(),
                mint.key.as_ref(),
                WSOL.as_ref(),
            ],
            &AMM,
        )
        .0;
        key_at(trade, 0, &pool)?;
        require(trade[0].owner == &AMM)?;
        key_at(trade, 6, balance.key)?;
        token_balance(destination, &RECIPIENT)?;
    }
    let mut metas = Vec::with_capacity(count);
    for (account, flag) in trade.iter().zip(flags) {
        require(
            *flag <= 3
                && (*flag & 1 == 0 || account.key == user.key)
                && account.key != &RECIPIENT
                && account.key != destination.key,
        )?;
        metas.push(AccountMeta {
            pubkey: *account.key,
            is_signer: *flag & 1 != 0,
            is_writable: *flag & 2 != 0,
        });
    }
    let sizes: Vec<usize> = trade.iter().map(|a| a.data_len()).collect();
    let before = if native {
        user.lamports()
    } else {
        token_balance(balance, user.key)?
    };
    invoke(
        &Instruction {
            program_id: target,
            accounts: metas,
            data: payload.to_vec(),
        },
        accounts,
    )?;
    if native
        && trade
            .iter()
            .zip(sizes)
            .any(|(account, size)| account.data_len() != size)
    {
        return Err(RENT_CHANGED);
    }
    let after = if native {
        user.lamports()
    } else {
        token_balance(balance, user.key)?
    };
    let gross = if buy {
        before.checked_sub(after)
    } else {
        after.checked_sub(before)
    }
    .ok_or(BAD_DELTA)?;
    if gross == 0 || (buy && gross > bound) || (!buy && gross < bound) {
        return Err(BAD_DELTA);
    }
    let fee = service_fee(gross);
    if fee != 0 {
        if native {
            invoke(
                &system_instruction::transfer(user.key, &RECIPIENT, fee),
                &[user.clone(), recipient.clone(), accounts[6].clone()],
            )?;
        } else {
            let mut bytes = vec![3u8]; // SPL Token Transfer, native WSOL units = lamports.
            bytes.extend_from_slice(&fee.to_le_bytes());
            invoke(
                &Instruction {
                    program_id: TOKEN,
                    accounts: vec![
                        AccountMeta::new(*balance.key, false),
                        AccountMeta::new(*destination.key, false),
                        AccountMeta::new_readonly(*user.key, true),
                    ],
                    data: bytes,
                },
                &[
                    balance.clone(),
                    destination.clone(),
                    user.clone(),
                    accounts[7].clone(),
                ],
            )?;
        }
    }
    let mut output = Vec::with_capacity(24);
    output.extend_from_slice(&gross.to_le_bytes());
    output.extend_from_slice(&fee.to_le_bytes());
    output.extend_from_slice(
        &if buy {
            gross.checked_add(fee).ok_or(BAD_DELTA)?
        } else {
            gross - fee
        }
        .to_le_bytes(),
    );
    set_return_data(&output);
    Ok(())
}

#[cfg(test)]
mod processor_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_integer_fee_and_no_overflow() {
        for (gross, fee) in [
            (0, 0),
            (399, 0),
            (400, 1),
            (999, 2),
            (1_000_000_000, 2_500_000),
            (u64::MAX, 46_116_860_184_273_879),
        ] {
            assert_eq!(service_fee(gross), fee);
        }
    }
    #[test]
    fn malformed_packets_fail_without_invocation() {
        for bytes in [
            vec![],
            vec![1],
            vec![2, 0, 0, 17],
            vec![1, 2, 0, 17],
            vec![1, 0, 2, 17],
            vec![1, 0, 0, 41],
            vec![1, 0, 0, 17],
        ] {
            assert_eq!(
                process_instruction(&Pubkey::new_unique(), &[], &bytes),
                Err(BAD)
            );
        }
    }
}
