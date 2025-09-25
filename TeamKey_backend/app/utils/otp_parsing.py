from __future__ import annotations

from urllib.parse import urlparse, parse_qs, unquote

from fastapi import HTTPException, status

from app.models.account import TotpAlgorithm


def parse_otpauth_url(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme != "otpauth" or parsed.netloc.lower() != "totp":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only otpauth TOTP URLs are supported")
    label = unquote(parsed.path.lstrip("/"))
    params = parse_qs(parsed.query)
    secret = params.get("secret", [None])[0]
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Secret is required in otpauth URL")
    issuer_param = params.get("issuer", [None])[0]
    algorithm_param = params.get("algorithm", [None])[0]
    digits_param = params.get("digits", [None])[0]
    period_param = params.get("period", [None])[0]

    issuer = issuer_param or ""
    account_identifier = label
    if not issuer and ":" in label:
        issuer, account_identifier = [part.strip() for part in label.split(":", 1)]

    algorithm = TotpAlgorithm(algorithm_param.upper()) if algorithm_param else TotpAlgorithm.SHA1
    digits = int(digits_param) if digits_param else 6
    period = int(period_param) if period_param else 30

    return {
        "issuer": issuer or account_identifier,
        "label": label,
        "account_identifier": account_identifier,
        "secret": secret.replace(" ", "").upper(),
        "digits": digits,
        "period": period,
        "algorithm": algorithm,
    }
