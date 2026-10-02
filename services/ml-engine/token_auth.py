from telemetry import traced
"""Asgardeo JWT access-token validation for the FastAPI resource server."""

import os
from functools import lru_cache
from typing import Any, Optional

import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient


ASGARDEO_ISSUER = os.getenv("ASGARDEO_ISSUER", "").rstrip("/")
ASGARDEO_AUDIENCE = os.getenv("ASGARDEO_AUDIENCE", "")
ASGARDEO_JWKS_URL = os.getenv("ASGARDEO_JWKS_URL", "")
bearer_scheme = HTTPBearer(auto_error=False)


@lru_cache(maxsize=1)
def get_jwks_client() -> PyJWKClient:
    if not ASGARDEO_ISSUER or not ASGARDEO_AUDIENCE:
        raise RuntimeError("ASGARDEO_ISSUER and ASGARDEO_AUDIENCE must be configured")

    jwks_url = ASGARDEO_JWKS_URL or f"{ASGARDEO_ISSUER.removesuffix('/oauth2/token')}/oauth2/jwks"
    return PyJWKClient(jwks_url, cache_keys=True, timeout=5)


@traced('require_asgardeo_user')
def require_asgardeo_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid Asgardeo access token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        if credentials.credentials.count(".") != 2:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The API requires a JWT access token. Select JWT in Asgardeo, save the application, then sign out and sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        signing_key = get_jwks_client().get_signing_key_from_jwt(credentials.credentials)
        return jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            audience=ASGARDEO_AUDIENCE,
            issuer=ASGARDEO_ISSUER,
            options={"require": ["exp", "iss", "aud", "sub"]},
            leeway=30,
        )
    except jwt.PyJWKClientError as error:
        raise HTTPException(status_code=503, detail="Could not validate Asgardeo signing keys.") from error
    except jwt.InvalidTokenError as error:
        if isinstance(error, jwt.ExpiredSignatureError):
            detail = "The Asgardeo access token has expired. Please sign out and sign in again."
        elif isinstance(error, jwt.InvalidAudienceError):
            detail = "The access token audience does not match ASGARDEO_AUDIENCE. Check the API audience configuration."
        elif isinstance(error, jwt.InvalidIssuerError):
            detail = "The access token issuer does not match ASGARDEO_ISSUER. Check that the frontend and API use the same Asgardeo tenant."
        else:
            detail = "The Asgardeo access token is invalid. Please sign out and sign in again."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        ) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
