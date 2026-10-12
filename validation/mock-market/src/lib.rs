//! LOCAL VM TEST DOUBLE ONLY. Not Pump code and never deploy to a public cluster.
//! Moves a fixed quote amount to test router accounting and runtime rollback.
#![allow(deprecated)]
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    system_instruction,
};
solana_program::entrypoint!(process);
const GROSS: u64 = 750_001_999;
const PUMP: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
fn process(id: &Pubkey, a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // The legacy SDK can request pool extension before the trade. The fixture
    // already has enough data; this test double only acknowledges that opcode.
    if id != &PUMP && data == [234, 102, 194, 203, 150, 72, 62, 229] {
        return Ok(());
    }
    if data.len() < 24 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let sell = data[..8] == [28, 146, 222, 119, 38, 196, 105, 213]
        || data[..8] == [93, 246, 130, 60, 231, 233, 64, 178]
        || data[..8] == [51, 230, 133, 164, 1, 127, 131, 173];
    if id == &PUMP {
        let legacy = data[..8] == [184, 23, 238, 97, 103, 197, 211, 61]
            || data[..8] == [93, 246, 130, 60, 231, 233, 64, 178];
        let user = &a[if legacy { 13 } else { 8 }];
        let curve = &a[if legacy { 10 } else { 5 }];
        if sell {
            **curve.try_borrow_mut_lamports()? -= GROSS;
            **user.try_borrow_mut_lamports()? += GROSS;
            Ok(())
        } else {
            invoke(&system_instruction::transfer(user.key, curve.key, GROSS), a)
        }
    } else {
        let (from, to, authority) = if sell {
            (&a[8], &a[6], &a[0])
        } else {
            (&a[6], &a[8], &a[1])
        };
        let mut bytes = vec![3];
        bytes.extend(GROSS.to_le_bytes());
        let ix = Instruction {
            program_id: TOKEN,
            accounts: vec![
                AccountMeta::new(*from.key, false),
                AccountMeta::new(*to.key, false),
                AccountMeta::new_readonly(*authority.key, true),
            ],
            data: bytes,
        };
        if sell {
            let creator =
                Pubkey::find_program_address(&[b"pool-authority", a[3].key.as_ref()], &PUMP).0;
            let (_, bump) = Pubkey::find_program_address(
                &[
                    b"pool",
                    &[0, 0],
                    creator.as_ref(),
                    a[3].key.as_ref(),
                    WSOL.as_ref(),
                ],
                id,
            );
            invoke_signed(
                &ix,
                a,
                &[&[
                    b"pool",
                    &[0, 0],
                    creator.as_ref(),
                    a[3].key.as_ref(),
                    WSOL.as_ref(),
                    &[bump],
                ]],
            )
        } else {
            invoke(&ix, a)
        }
    }
}
