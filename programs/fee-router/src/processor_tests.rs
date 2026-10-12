//! Host-side tests with deterministic CPI stubs. These are not validator or
//! mainnet protocol tests; they exercise our validation and balance accounting.
use super::*;
use solana_program::program_stubs::{set_syscall_stubs, SyscallStubs};
use std::sync::{Arc, Mutex};

fn account(
    key: Pubkey,
    owner: Pubkey,
    lamports: u64,
    data: Vec<u8>,
    signer: bool,
    writable: bool,
    executable: bool,
) -> AccountInfo<'static> {
    AccountInfo::new(
        Box::leak(Box::new(key)),
        signer,
        writable,
        Box::leak(Box::new(lamports)),
        Box::leak(data.into_boxed_slice()),
        Box::leak(Box::new(owner)),
        executable,
        0,
    )
}
fn token_data(owner: Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0; 165];
    data[..32].copy_from_slice(WSOL.as_ref());
    data[32..64].copy_from_slice(owner.as_ref());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    data[109] = 1;
    data
}
fn fixture(native: bool, buy: bool, legacy: bool) -> (Vec<AccountInfo<'static>>, Vec<u8>) {
    let user_key = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let curve_key = Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &PUMP).0;
    let mut curve_data = vec![0; 150];
    curve_data[..8].copy_from_slice(&CURVE_DISCRIMINATOR);
    curve_data[48] = u8::from(!native);
    let user = account(
        user_key,
        system_program::ID,
        10_000_000_000,
        vec![],
        true,
        true,
        false,
    );
    let recipient = account(
        RECIPIENT,
        system_program::ID,
        10_000_000,
        vec![],
        false,
        true,
        false,
    );
    let curve = account(
        curve_key,
        PUMP,
        10_000_000_000,
        curve_data,
        false,
        true,
        false,
    );
    let mint_account = account(mint, TOKEN, 10_000_000, vec![0; 82], false, false, false);
    let balance = if native {
        user.clone()
    } else {
        account(
            ata(&user_key),
            TOKEN,
            10_002_039_280,
            token_data(user_key, 10_000_000_000),
            false,
            true,
            false,
        )
    };
    let destination = if native {
        recipient.clone()
    } else {
        account(
            ata(&RECIPIENT),
            TOKEN,
            2_039_280,
            token_data(RECIPIENT, 0),
            false,
            true,
            false,
        )
    };
    let target = if native { PUMP } else { AMM };
    let mut accounts = vec![
        user.clone(),
        recipient,
        curve.clone(),
        mint_account.clone(),
        balance.clone(),
        destination,
        account(
            system_program::ID,
            Pubkey::new_unique(),
            1,
            vec![],
            false,
            false,
            true,
        ),
        account(TOKEN, Pubkey::new_unique(), 1, vec![], false, false, true),
        account(target, Pubkey::new_unique(), 1, vec![], false, false, true),
    ];
    let (disc, user_index, volume_index, count) = match (native, buy, legacy) {
        (true, true, false) => (BUY_V3, 8, 11, 17),
        (true, true, true) => (BUY_V2, 13, 20, 27),
        (true, false, false) => (SELL_V3, 8, 11, 17),
        (true, false, true) => (SELL_V2, 13, 19, 26),
        (false, true, false) => (BUY_EXACT_AMM, 1, 12, 17),
        (false, true, true) => (BUY_AMM, 1, 20, 23),
        (false, false, false) => (SELL_V2, 1, 12, 17),
        (false, false, true) => (SELL_AMM, 1, 0, 21),
    };
    let mut trade: Vec<_> = (0..count)
        .map(|_| {
            account(
                Pubkey::new_unique(),
                target,
                1,
                vec![0; 16],
                false,
                true,
                false,
            )
        })
        .collect();
    trade[user_index] = user;
    trade[if native { 1 } else { 3 }] = mint_account;
    trade[if native { 2 } else { 4 }] = account(WSOL, TOKEN, 1, vec![0; 82], false, false, false);
    if native {
        trade[if legacy { 10 } else { 5 }] = curve;
        trade[volume_index] = account(
            Pubkey::find_program_address(&[b"user_volume_accumulator", user_key.as_ref()], &PUMP).0,
            PUMP,
            1,
            vec![0; 128],
            false,
            true,
            false,
        );
    } else {
        let creator = Pubkey::find_program_address(&[b"pool-authority", mint.as_ref()], &PUMP).0;
        let pool = Pubkey::find_program_address(
            &[
                b"pool",
                &[0, 0],
                creator.as_ref(),
                mint.as_ref(),
                WSOL.as_ref(),
            ],
            &AMM,
        )
        .0;
        trade[0] = account(pool, AMM, 1, vec![0; 256], false, true, false);
        trade[6] = balance;
    }
    let mut data = vec![1, u8::from(!native), u8::from(!buy), count as u8];
    data.extend(
        trade
            .iter()
            .map(|a| u8::from(a.is_signer) | (u8::from(a.is_writable) << 1)),
    );
    data.extend(disc);
    data.extend(1_000_000_000u64.to_le_bytes());
    data.extend(
        if buy && legacy {
            1_000_000_000u64
        } else {
            100_000_000u64
        }
        .to_le_bytes(),
    );
    accounts.extend(trade);
    (accounts, data)
}

struct CpiMock {
    calls: Arc<Mutex<Vec<Pubkey>>>,
    gross: u64,
    fail_trade: bool,
}
impl SyscallStubs for CpiMock {
    fn sol_invoke_signed(
        &self,
        ix: &Instruction,
        accounts: &[AccountInfo],
        _seeds: &[&[&[u8]]],
    ) -> ProgramResult {
        self.calls.lock().unwrap().push(ix.program_id);
        if ix.program_id == PUMP || ix.program_id == AMM {
            if self.fail_trade {
                return Err(ProgramError::Custom(9999));
            }
            let buy = ![SELL_V2, SELL_V3, SELL_AMM]
                .iter()
                .any(|d| ix.data[..8] == *d);
            if ix.program_id == PUMP {
                let old = accounts[0].lamports();
                **accounts[0].try_borrow_mut_lamports()? = if buy {
                    old - self.gross
                } else {
                    old + self.gross
                };
            } else {
                let mut bytes = accounts[4].try_borrow_mut_data()?;
                let old = word(&bytes, 64)?;
                bytes[64..72].copy_from_slice(
                    &if buy {
                        old - self.gross
                    } else {
                        old + self.gross
                    }
                    .to_le_bytes(),
                );
            }
        } else if ix.program_id == system_program::ID {
            let fee = word(&ix.data, 4)?;
            **accounts[0].try_borrow_mut_lamports()? -= fee;
            **accounts[1].try_borrow_mut_lamports()? += fee;
        } else if ix.program_id == TOKEN {
            assert_eq!(ix.data[0], 3);
            let fee = word(&ix.data, 1)?;
            let a = token_balance(&accounts[0], accounts[2].key)?;
            let b = token_balance(&accounts[1], &RECIPIENT)?;
            accounts[0].try_borrow_mut_data()?[64..72].copy_from_slice(&(a - fee).to_le_bytes());
            accounts[1].try_borrow_mut_data()?[64..72].copy_from_slice(&(b + fee).to_le_bytes());
        } else {
            return Err(BAD);
        };
        Ok(())
    }
}

#[test]
fn accounting_and_attack_cases_with_mocked_cpi() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let previous = set_syscall_stubs(Box::new(CpiMock {
        calls: calls.clone(),
        gross: 750_001_999,
        fail_trade: false,
    }));
    let router = Pubkey::new_unique();
    for native in [true, false] {
        for buy in [true, false] {
            for legacy in [true, false] {
                let (accounts, data) = fixture(native, buy, legacy);
                calls.lock().unwrap().clear();
                let before = if native {
                    accounts[1].lamports()
                } else {
                    token_balance(&accounts[5], &RECIPIENT).unwrap()
                };
                process_instruction(&router, &accounts, &data).unwrap();
                let after = if native {
                    accounts[1].lamports()
                } else {
                    token_balance(&accounts[5], &RECIPIENT).unwrap()
                };
                assert_eq!(after - before, 1_875_004); // actual 0.750001999 SOL, NOT the quoted 1 SOL
                assert_eq!(
                    *calls.lock().unwrap(),
                    vec![
                        if native { PUMP } else { AMM },
                        if native { system_program::ID } else { TOKEN }
                    ]
                );
            }
        }
    }
    for attack in 0..11 {
        let (mut accounts, mut data) = fixture(false, false, false);
        calls.lock().unwrap().clear();
        match attack {
            0 => accounts[0].is_signer = false,
            1 => accounts[1].key = Box::leak(Box::new(Pubkey::new_unique())),
            2 => accounts[8].key = Box::leak(Box::new(Pubkey::new_unique())),
            3 => accounts[2].try_borrow_mut_data().unwrap()[48] = 0,
            4 => accounts[2].owner = Box::leak(Box::new(system_program::ID)),
            5 => accounts[5].try_borrow_mut_data().unwrap()[32..64]
                .copy_from_slice(Pubkey::new_unique().as_ref()),
            6 => accounts[4].try_borrow_mut_data().unwrap()[0] = 0,
            7 => data[4 + 17] = 0, // unsupported instruction discriminator
            8 => accounts[9].key = Box::leak(Box::new(Pubkey::new_unique())), // noncanonical pool
            9 => data[4 + 2] = 1,  // foreign CPI signer
            10 => accounts[9 + 1].key = Box::leak(Box::new(Pubkey::new_unique())),
            _ => unreachable!(),
        }
        assert!(
            process_instruction(&router, &accounts, &data).is_err(),
            "attack {attack}"
        );
        assert!(
            calls.lock().unwrap().is_empty(),
            "attack {attack} invoked CPI"
        );
    }
    set_syscall_stubs(Box::new(CpiMock {
        calls: calls.clone(),
        gross: 750_001_999,
        fail_trade: true,
    }));
    let (accounts, data) = fixture(true, false, false);
    calls.lock().unwrap().clear();
    let recipient_before = accounts[1].lamports();
    assert_eq!(
        process_instruction(&router, &accounts, &data),
        Err(ProgramError::Custom(9999))
    );
    assert_eq!(accounts[1].lamports(), recipient_before);
    assert_eq!(*calls.lock().unwrap(), vec![PUMP]);
    set_syscall_stubs(previous);
}
