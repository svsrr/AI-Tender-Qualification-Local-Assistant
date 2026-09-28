import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { db } from '../lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export const EmployeeIdModal: React.FC = () => {
  const { firebaseUser, setEmployeeId } = useApp();
  const [id, setId] = useState('');
  const [loading, setLoading] = useState(false);

  const saveId = async () => {
    if (!id || id.length !== 8) return;
    setLoading(true);
    try {
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        await setDoc(userRef, { employeeId: id }, { merge: true });
        setEmployeeId(id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full space-y-4">
        <h2 className="text-xl font-bold">Enter Employee ID</h2>
        <p className="text-sm text-slate-500">Please enter your 8-digit employee ID to continue.</p>
        <input
          type="text"
          maxLength={8}
          value={id}
          onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
          className="w-full p-3 border rounded-xl"
          placeholder="e.g., 12345678"
        />
        <button
          onClick={saveId}
          disabled={loading || id.length !== 8}
          className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
};
