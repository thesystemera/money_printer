import firebase_admin
from firebase_admin import credentials, auth

CRED_PATH = 'config/money-printer-1b3c5-firebase-adminsdk-fbsvc-eb22afee42.json'
ADMIN_EMAIL = "info@realityvirtual.co"


def set_all_user_tiers():
    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(CRED_PATH)
            firebase_admin.initialize_app(cred)
        print("✅ Firebase Admin SDK initialized.")

        print("Fetching all users from Firebase. This may take a moment...")
        all_users = auth.list_users()

        for user in all_users.iterate_all():
            try:
                if not user.email:
                    print(f"⚠️ Skipping user UID: {user.uid} (no email address).")
                    continue

                print(f"\nProcessing {user.email}...")

                target_tier = "admin" if user.email == ADMIN_EMAIL else "premium"
                new_claims = {'tier': target_tier}

                if user.custom_claims and user.custom_claims.get('tier') == target_tier:
                    print(f"✔️ User {user.email} already has the '{target_tier}' tier. Skipping.")
                    continue

                auth.set_custom_user_claims(user.uid, new_claims)
                print(f"🚀 Successfully set tier '{target_tier}' for {user.email} (UID: {user.uid})")

            except Exception as e:
                print(f"❌ ERROR processing {user.email}: {e}")

        print("\n\n✅ All users have been processed.")

    except Exception as e:
        print(f"❌ A critical error occurred: {e}")


if __name__ == "__main__":
    set_all_user_tiers()