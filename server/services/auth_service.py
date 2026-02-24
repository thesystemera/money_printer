import firebase_admin
from firebase_admin import credentials, auth
from fastapi import HTTPException, status
from models.user import User

if not firebase_admin._apps:
    cred = credentials.Certificate("config/money-printer-1b3c5-firebase-adminsdk-fbsvc-eb22afee42.json")
    firebase_admin.initialize_app(cred)

def verify_token(token: str) -> User:
    try:
        decoded_token = auth.verify_id_token(token)

        tier = decoded_token.get('tier', 'guest')

        email = decoded_token.get("email")
        email_verified = decoded_token.get("email_verified", False)

        print(f"--- DEBUG: Verifying token for email: {email}, Tier: {tier} ---")

        if not email_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="🎯 MONEY PRINTER: Almost there! Please check your inbox and click the email verification link we sent you.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if tier == 'guest':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"🎯 MONEY PRINTER: Your account ({email}) is pending VIP approval. Access is restricted to authorized users.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return User(
            uid=decoded_token.get("uid"),
            email=email,
            tier=tier
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication credentials: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )
