import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { CommitteeMember } from '../types';
import {
  Users,
  ShieldCheck,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  Edit3,
  Calendar,
  Building,
  UserCheck,
} from 'lucide-react';

interface EditCommitteeModalProps {
  onClose: () => void;
}

export const EditCommitteeModal: React.FC<EditCommitteeModalProps> = ({ onClose }) => {
  const { ioclMetadata, updateIoclMetadata, addAuditLog } = useApp();

  const [signatories, setSignatories] = useState({
    approvingAuthority: ioclMetadata?.signatories?.approvingAuthority !== undefined ? ioclMetadata?.signatories?.approvingAuthority : {
      name: 'Approving Authority',
      title: 'Signature of Approving Authority',
      designation: '',
      department: '',
      signDate: '',
      status: '',
    },
    nextSuperiorOfficer: ioclMetadata?.signatories?.nextSuperiorOfficer !== undefined ? ioclMetadata?.signatories?.nextSuperiorOfficer : {
      name: 'Next Superior Officer',
      title: 'Signature of Next Superior Officer',
      designation: '',
      department: '',
      signDate: '',
      status: '',
    },
    superiorOfficer: ioclMetadata?.signatories?.superiorOfficer !== undefined ? ioclMetadata?.signatories?.superiorOfficer : {
      name: 'Superior Officer',
      title: 'Signature of Superior Officer',
      designation: '',
      department: '',
      signDate: '',
      status: '',
    },
    initiator: ioclMetadata?.signatories?.initiator !== undefined ? ioclMetadata?.signatories?.initiator : {
      name: 'Initiator',
      title: 'Signature of Initiator',
      designation: '',
      department: '',
      signDate: '',
      status: '',
    },
  });

  const [committeeMembers, setCommitteeMembers] = useState<CommitteeMember[]>(
    ioclMetadata?.committeeMembers && ioclMetadata.committeeMembers.length > 0
      ? ioclMetadata.committeeMembers
      : // No sample members: the committee is whoever the engineer adds, with their own designations.
        []
  );

  const [newMember, setNewMember] = useState<Partial<CommitteeMember>>({
    name: '',
    designation: '',
    role: 'Technical Reviewer',
    department: 'Engineering Services',
    signDate: new Date().toLocaleDateString('en-GB').replace(/\//g, '.'),
    status: 'Pending Review',
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleAddMember = () => {
    if (!newMember.name || !newMember.designation) {
      alert('Please provide member name and designation.');
      return;
    }

    const created: CommitteeMember = {
      id: `cm-${Date.now()}`,
      name: newMember.name,
      designation: newMember.designation,
      role: newMember.role || 'Review Panel Member',
      department: newMember.department || 'Refinery Directorate',
      signDate: newMember.signDate || new Date().toLocaleDateString('en-GB').replace(/\//g, '.'),
      status: (newMember.status as any) || 'Signed',
      employeeId: newMember.employeeId || `EMP-${Math.floor(10000 + Math.random() * 90000)}`,
    };

    setCommitteeMembers([...committeeMembers, created]);
    setNewMember({
      name: '',
      designation: '',
      role: 'Technical Reviewer',
      department: 'Engineering Services',
      signDate: new Date().toLocaleDateString('en-GB').replace(/\//g, '.'),
      status: 'Signed',
    });
    setShowAddForm(false);
  };

  const handleRemoveMember = (id: string) => {
    setCommitteeMembers(committeeMembers.filter((m) => m.id !== id));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateIoclMetadata({
      signatories,
      committeeMembers,
    });

    addAuditLog({
      action: 'Tender Signatories & Review Panel Updated',
      oldValue: 'Previous Signatories',
      newValue: `Updated ${committeeMembers.length} Review Panel Members & 3 Statutory Signatories`,
      reason: 'User modified technical evaluation signatories and reviewer details.',
    });

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden my-8 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Edit Evaluation Signatories & Review Panel</h3>
              <p className="text-xs text-slate-400">Configure technical bid evaluation signatories and review panel members</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto flex-1 space-y-6 text-xs">
          {savedSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-800 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Signatories and review panel saved successfully!</span>
            </div>
          )}

          {/* 1. Statutory Evaluation Signatories */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <h4 className="font-bold text-sm text-slate-800">Statutory Evaluation Signatories (Page 6 Master)</h4>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">Multi-Tier Verification (Delete slots if fewer signers)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Approving Authority */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 relative">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">
                    1. Approving Authority
                  </span>
                  {signatories.approvingAuthority !== null ? (
                    <button
                      type="button"
                      onClick={() => setSignatories({ ...signatories, approvingAuthority: null })}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition"
                      title="Delete this signature slot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setSignatories({
                          ...signatories,
                          approvingAuthority: {
                            name: 'Approving Authority',
                            title: 'Signature of Approving Authority',
                            designation: '',
                            department: '',
                            signDate: '',
                            status: '',
                          },
                        })
                      }
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      + Add Slot
                    </button>
                  )}
                </div>
                {signatories.approvingAuthority !== null ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Signatory Name</label>
                      <input
                        type="text"
                        value={signatories.approvingAuthority.name}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            approvingAuthority: { ...signatories.approvingAuthority!, name: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                        placeholder="Full Name"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Designation</label>
                      <input
                        type="text"
                        value={signatories.approvingAuthority.designation}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            approvingAuthority: { ...signatories.approvingAuthority!, designation: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. DGM(MN-CL)"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Date</label>
                        <input
                          type="text"
                          value={signatories.approvingAuthority.signDate}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              approvingAuthority: { ...signatories.approvingAuthority!, signDate: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Status</label>
                        <select
                          value={signatories.approvingAuthority.status}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              approvingAuthority: { ...signatories.approvingAuthority!, status: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        >
                          <option value="Approved">Approved</option>
                          <option value="Signed">Signed</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs italic py-4 text-center">Slot removed (will not appear in TBA)</div>
                )}
              </div>

              {/* Next Superior Officer */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 relative">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">
                    2. Next Superior Officer
                  </span>
                  {signatories.nextSuperiorOfficer !== null ? (
                    <button
                      type="button"
                      onClick={() => setSignatories({ ...signatories, nextSuperiorOfficer: null })}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition"
                      title="Delete this signature slot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setSignatories({
                          ...signatories,
                          nextSuperiorOfficer: {
                            name: 'Next Superior Officer',
                            title: 'Signature of Next Superior Officer',
                            designation: '',
                            department: '',
                            signDate: '',
                            status: '',
                          },
                        })
                      }
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      + Add Slot
                    </button>
                  )}
                </div>
                {signatories.nextSuperiorOfficer !== null ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Signatory Name</label>
                      <input
                        type="text"
                        value={signatories.nextSuperiorOfficer.name}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            nextSuperiorOfficer: { ...signatories.nextSuperiorOfficer!, name: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                        placeholder="Full Name"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Designation</label>
                      <input
                        type="text"
                        value={signatories.nextSuperiorOfficer.designation}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            nextSuperiorOfficer: { ...signatories.nextSuperiorOfficer!, designation: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. CMNMCL"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Date</label>
                        <input
                          type="text"
                          value={signatories.nextSuperiorOfficer.signDate}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              nextSuperiorOfficer: { ...signatories.nextSuperiorOfficer!, signDate: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Status</label>
                        <select
                          value={signatories.nextSuperiorOfficer.status}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              nextSuperiorOfficer: { ...signatories.nextSuperiorOfficer!, status: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        >
                          <option value="Concurred">Concurred</option>
                          <option value="Approved">Approved</option>
                          <option value="Signed">Signed</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs italic py-4 text-center">Slot removed (will not appear in TBA)</div>
                )}
              </div>

              {/* Superior Officer */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 relative">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">
                    3. Superior Officer (Evaluator)
                  </span>
                  {signatories.superiorOfficer !== null ? (
                    <button
                      type="button"
                      onClick={() => setSignatories({ ...signatories, superiorOfficer: null })}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition"
                      title="Delete this signature slot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setSignatories({
                          ...signatories,
                          superiorOfficer: {
                            name: 'Superior Officer',
                            title: 'Signature of Superior Officer',
                            designation: '',
                            department: '',
                            signDate: '',
                            status: '',
                          },
                        })
                      }
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      + Add Slot
                    </button>
                  )}
                </div>
                {signatories.superiorOfficer !== null ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Signatory Name</label>
                      <input
                        type="text"
                        value={signatories.superiorOfficer.name}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            superiorOfficer: { ...signatories.superiorOfficer!, name: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                        placeholder="Full Name"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Designation</label>
                      <input
                        type="text"
                        value={signatories.superiorOfficer.designation}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            superiorOfficer: { ...signatories.superiorOfficer!, designation: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. SMNMCL"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Date</label>
                        <input
                          type="text"
                          value={signatories.superiorOfficer.signDate}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              superiorOfficer: { ...signatories.superiorOfficer!, signDate: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Status</label>
                        <select
                          value={signatories.superiorOfficer.status}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              superiorOfficer: { ...signatories.superiorOfficer!, status: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        >
                          <option value="Initiated & Evaluated">Initiated & Evaluated</option>
                          <option value="Approved">Approved</option>
                          <option value="Signed">Signed</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs italic py-4 text-center">Slot removed (will not appear in TBA)</div>
                )}
              </div>

              {/* 4. Signature of Initiator */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 relative">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">
                    4. Signature of Initiator
                  </span>
                  {signatories.initiator !== null ? (
                    <button
                      type="button"
                      onClick={() => setSignatories({ ...signatories, initiator: null })}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition"
                      title="Delete this signature slot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setSignatories({
                          ...signatories,
                          initiator: {
                            name: 'Initiator',
                            title: 'Signature of Initiator',
                            designation: '',
                            department: '',
                            signDate: '',
                            status: '',
                          },
                        })
                      }
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      + Add Slot
                    </button>
                  )}
                </div>
                {signatories.initiator !== null ? (
                  <>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Signatory Name</label>
                      <input
                        type="text"
                        value={signatories.initiator.name}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            initiator: { ...signatories.initiator!, name: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-blue-500"
                        placeholder="Full Name"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Designation</label>
                      <input
                        type="text"
                        value={signatories.initiator.designation}
                        onChange={(e) =>
                          setSignatories({
                            ...signatories,
                            initiator: { ...signatories.initiator!, designation: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. Chief Manager"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Date</label>
                        <input
                          type="text"
                          value={signatories.initiator.signDate}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              initiator: { ...signatories.initiator!, signDate: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Status</label>
                        <select
                          value={signatories.initiator.status}
                          onChange={(e) =>
                            setSignatories({
                              ...signatories,
                              initiator: { ...signatories.initiator!, status: e.target.value },
                            })
                          }
                          className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                        >
                          <option value="Initiated">Initiated</option>
                          <option value="Approved">Approved</option>
                          <option value="Signed">Signed</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400 text-xs italic py-4 text-center">Slot removed (will not appear in TBA)</div>
                )}
              </div>
            </div>
          </div>

          {/* 2. Evaluation Review Panel Members */}
          <div className="space-y-3 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-600" />
                  <span>Technical Review Panel Members ({committeeMembers.length})</span>
                </h4>
                <p className="text-[11px] text-slate-500">Reviewers appearing on formal Technical Evaluation Reports and Sign-off documents</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Member</span>
              </button>
            </div>

            {/* List of Panel Members */}
            <div className="space-y-2.5">
              {committeeMembers.map((member, index) => (
                <div
                  key={member.id || index}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">Name</span>
                      <input
                        type="text"
                        value={member.name}
                        onChange={(e) => {
                          const updated = [...committeeMembers];
                          updated[index].name = e.target.value;
                          setCommitteeMembers(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">Designation</span>
                      <input
                        type="text"
                        value={member.designation}
                        onChange={(e) => {
                          const updated = [...committeeMembers];
                          updated[index].designation = e.target.value;
                          setCommitteeMembers(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">Panel Role</span>
                      <input
                        type="text"
                        value={member.role}
                        onChange={(e) => {
                          const updated = [...committeeMembers];
                          updated[index].role = e.target.value;
                          setCommitteeMembers(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">Department / Division</span>
                      <input
                        type="text"
                        value={member.department}
                        onChange={(e) => {
                          const updated = [...committeeMembers];
                          updated[index].department = e.target.value;
                          setCommitteeMembers(updated);
                        }}
                        className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
                      {member.status || 'Signed'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-100/70 rounded-md transition-colors"
                      title="Remove Member"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Member Subform */}
            {showAddForm && (
              <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 space-y-3 animate-in fade-in">
                <div className="font-bold text-xs text-blue-900">Add New Review Panel Member</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Officer Name</label>
                    <input
                      type="text"
                      value={newMember.name}
                      onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                      placeholder="e.g. Dr. A. K. Verma"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Designation</label>
                    <input
                      type="text"
                      value={newMember.designation}
                      onChange={(e) => setNewMember({ ...newMember, designation: e.target.value })}
                      placeholder="e.g. General Manager (Technical)"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Panel Role</label>
                    <input
                      type="text"
                      value={newMember.role}
                      onChange={(e) => setNewMember({ ...newMember, role: e.target.value })}
                      placeholder="e.g. Finance Member / Technical Reviewer"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">Department / Organization</label>
                    <input
                      type="text"
                      value={newMember.department}
                      onChange={(e) => setNewMember({ ...newMember, department: e.target.value })}
                      placeholder="e.g. Finance Directorate / Refinery"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddMember}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                  >
                    Add to Review Panel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-md transition"
            >
              Save Signatories & Review Panel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

