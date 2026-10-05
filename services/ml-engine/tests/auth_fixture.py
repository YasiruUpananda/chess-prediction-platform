"""Ephemeral RS256 fixture; never used by the production server."""
import time
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
import token_auth


@contextmanager
def signed_sessions():
    private = rsa.generate_private_key(public_exponent=65537,key_size=2048)
    def token(owner, **overrides):
        return jwt.encode({'sub':owner,'iss':'https://test.invalid','aud':'test-api',
                           'exp':int(time.time())+3600,**overrides},private,algorithm='RS256')
    client = SimpleNamespace(get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=private.public_key()))
    with patch.object(token_auth,'ASGARDEO_ISSUER','https://test.invalid'), \
         patch.object(token_auth,'ASGARDEO_AUDIENCE','test-api'), \
         patch.object(token_auth,'get_jwks_client',return_value=client):
        yield token
