from __future__ import annotations

from datetime import datetime
import hashlib
import pyotp

from app.models.account import Account, TotpAlgorithm
from app.utils.crypto import decrypt_secret

ALG_MAP = {
    TotpAlgorithm.SHA1: hashlib.sha1,
    TotpAlgorithm.SHA256: hashlib.sha256,
    TotpAlgorithm.SHA512: hashlib.sha512,
}


def _totp_for_account(account: Account) -> pyotp.TOTP:
    secret = decrypt_secret(account.secret_enc, account.salt)
    digest = ALG_MAP.get(account.algorithm, hashlib.sha1)
    return pyotp.TOTP(secret, digits=account.digits, interval=account.period, digest=digest)


def generate_code(account: Account) -> dict[str, int | str]:
    totp = _totp_for_account(account)
    code = totp.now()
    period = account.period
    current = int(datetime.utcnow().timestamp())
    counter = current // period
    expires_at = (counter + 1) * period
    remaining = expires_at - current
    return {
        "code": code,
        "period": period,
        "expires_in": max(0, remaining),
    }
