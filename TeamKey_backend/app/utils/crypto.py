from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from app.core.settings import settings


@dataclass
class EncryptionResult:
    cipher_text: str
    salt: str


def _derive_key(salt: bytes) -> bytes:
    master_key = settings.server_master_key.encode("utf-8")
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=120_000)
    return kdf.derive(master_key)


def encrypt_secret(plain_text: str) -> EncryptionResult:
    salt = os.urandom(16)
    key = _derive_key(salt)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    cipher_bytes = aesgcm.encrypt(nonce, plain_text.encode("utf-8"), None)
    payload: dict[str, Any] = {
        "v": 1,
        "iv": base64.b64encode(nonce).decode(),
        "data": base64.b64encode(cipher_bytes).decode(),
    }
    return EncryptionResult(cipher_text=json.dumps(payload), salt=base64.b64encode(salt).decode())


def decrypt_secret(cipher_text: str, salt: str) -> str:
    payload = json.loads(cipher_text)
    nonce = base64.b64decode(payload["iv"])
    data = base64.b64decode(payload["data"])
    salt_bytes = base64.b64decode(salt)
    key = _derive_key(salt_bytes)
    aesgcm = AESGCM(key)
    plain = aesgcm.decrypt(nonce, data, None)
    return plain.decode("utf-8")


def generate_token(n_bytes: int = 24) -> str:
    return base64.urlsafe_b64encode(os.urandom(n_bytes)).decode().rstrip("=")
