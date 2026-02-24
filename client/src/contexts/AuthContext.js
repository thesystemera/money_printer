import React, { useContext, useState, useEffect } from 'react';
import { auth } from '../firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification
} from 'firebase/auth';

const AuthContext = React.createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [userTier, setUserTier] = useState('guest');

  function signup(email, password) {
    return createUserWithEmailAndPassword(auth, email, password).then(result => {
      return sendEmailVerification(result.user).then(() => result);
    });
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    setUserTier('guest');
    return signOut(auth);
  }

  function reloadUser() {
    if (currentUser) {
      return currentUser.reload().then(() => {
        setCurrentUser({ ...auth.currentUser });
      });
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        if (user.emailVerified) {
          const idTokenResult = await user.getIdTokenResult();
          const tier = idTokenResult.claims.tier || 'guest';
          setUserTier(tier);
          setCurrentUser(user);
          setNeedsVerification(false);
        } else {
          setCurrentUser(user);
          setNeedsVerification(true);
          setUserTier('guest');
        }
      } else {
        setCurrentUser(null);
        setNeedsVerification(false);
        setUserTier('guest');
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    needsVerification,
    userTier,
    signup,
    login,
    logout,
    reloadUser
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
