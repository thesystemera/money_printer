from pydantic import BaseModel, EmailStr
from typing import Optional

class User(BaseModel):
    uid: str
    email: Optional[EmailStr] = None
    tier: str = 'guest'