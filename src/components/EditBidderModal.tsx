import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { IoclBidderEvaluation, Bidder } from '../types';
import { X, Save, Building2, MapPin, User, Mail, Phone, Hash, Award, CheckCircle2 } from 'lucide-react';

interface EditBidderModalProps {
  bidder: IoclBidderEvaluation | Bidder;
  onClose: () => void;
}

export const EditBidderModal: React.FC<EditBidderModalProps> = ({ bidder, onClose }) => {
  const { updateIoclBidder, updateBidder, ioclBidders, bidders, addAuditLog } = useApp();

  const isIoclBidder = 'workOrders' in bidder;

  // Find matching records in both arrays to pre-fill all fields
  const matchingIocl = ioclBidders.find((b) => b.id === bidder.id || b.bidderName === bidder.bidderName);
  const matchingStandard = bidders.find((b) => b.id === bidder.id || b.bidderName === bidder.bidderName);

  const initialName = bidder.bidderName || (bidder as any).companyName || '';
  const initialCityState = (bidder as IoclBidderEvaluation).cityState || 'Bhubaneswar, Odisha';
  const initialContact = bidder.contactPerson || matchingStandard?.contactPerson || matchingIocl?.contactPerson || '';
  const initialGstin = bidder.gstin || matchingStandard?.gstin || matchingIocl?.gstin || '';
  const initialEmail = matchingStandard?.email || 'bidder@engineering.com';
  const initialPhone = matchingStandard?.phone || '+91 98000 00000';
  const initialCategory = matchingStandard?.category || 'Class-I Local Supplier (MII >= 70%)';

  const [formData, setFormData] = useState({
    bidderName: initialName,
    cityState: initialCityState,
    contactPerson: initialContact,
    gstin: initialGstin,
    email: initialEmail,
    phone: initialPhone,
    category: initialCategory,
    editReason: 'Evaluator name correction / profile update',
  });

  const [isSaved, setIsSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.bidderName.trim()) {
      alert('Bidder name cannot be empty.');
      return;
    }

    const trimmedName = formData.bidderName.trim();
    const trimmedCityState = formData.cityState.trim() || 'Bhubaneswar, Odisha';

    // 1. Update IOCL Evaluation Sheet bidder record
    if (matchingIocl || isIoclBidder) {
      const ioclId = (bidder as IoclBidderEvaluation).id || matchingIocl?.id;
      if (ioclId) {
        updateIoclBidder(ioclId, {
          bidderName: trimmedName,
          cityState: trimmedCityState,
          contactPerson: formData.contactPerson,
          gstin: formData.gstin,
        });
      }
    }

    // 2. Update Standard Bidder Management record
    const stdId = (bidder as Bidder).id || matchingStandard?.id;
    if (stdId) {
      updateBidder(stdId, {
        bidderName: trimmedName,
        companyName: trimmedName,
        contactPerson: formData.contactPerson,
        gstin: formData.gstin,
        email: formData.email,
        phone: formData.phone,
        category: formData.category,
      });
    }

    // 3. Add Audit Log Entry
    addAuditLog({
      action: 'Bidder Name & Profile Modified',
      bidderName: trimmedName,
      oldValue: initialName,
      newValue: trimmedName,
      reason: formData.editReason,
    });

    setIsSaved(true);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight">Edit Bidder</h3>
              <p className="text-xs text-slate-300">
                Update bidder name and details
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Banner */}
        {isSaved && (
          <div className="bg-emerald-50 border-b border-emerald-200 p-3 text-center text-xs font-bold text-emerald-800 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Bidder name updated!</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
          {/* Bidder Name */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span>Bidder / Company Name <span className="text-red-500">*</span></span>
            </label>
            <input
              type="text"
              required
              value={formData.bidderName}
              onChange={(e) => setFormData({ ...formData, bidderName: e.target.value })}
              placeholder="e.g. M/s Balimeen Private Limited"
              className="w-full px-3 py-2 text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            />
            <p className="text-[10px] text-slate-400">
              This name will appear across all reports and exports.
            </p>
          </div>

          {/* City / Location */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span>Registered Location (City, State)</span>
            </label>
            <input
              type="text"
              value={formData.cityState}
              onChange={(e) => setFormData({ ...formData, cityState: e.target.value })}
              placeholder="e.g. Bhubaneswar, Odisha"
              className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            />
          </div>

          {/* Contact Person & GSTIN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span>Authorized Contact Person</span>
              </label>
              <input
                type="text"
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                placeholder="Representative Name"
                className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-slate-500" />
                <span>GSTIN / Tax Reg No.</span>
              </label>
              <input
                type="text"
                value={formData.gstin}
                onChange={(e) => setFormData({ ...formData, gstin: e.target.value })}
                placeholder="21AAAAA0000A1Z5"
                className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>Email Address</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="bidder@company.com"
                className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-500" />
                <span>Phone / Mobile</span>
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+91 98000 00000"
                className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>
          </div>

          {/* Supplier Category */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-600" />
              <span>Make In India (MII) Supplier Category</span>
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            >
              <option value="Class-I Local Supplier (MII >= 70%)">Class-I Local Supplier (MII &ge; 70%)</option>
              <option value="Class-II Local Supplier (MII 20-70%)">Class-II Local Supplier (MII 20-70%)</option>
              <option value="Non-Local Supplier (MII < 20%)">Non-Local Supplier (MII &lt; 20%)</option>
              <option value="MSE (Micro & Small Enterprise)">MSE (Micro &amp; Small Enterprise)</option>
            </select>
          </div>

          {/* Edit Reason Note */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Audit Note / Reason for Edit
            </label>
            <input
              type="text"
              value={formData.editReason}
              onChange={(e) => setFormData({ ...formData, editReason: e.target.value })}
              placeholder="e.g. Corrected spelling as per GST registration certificate"
              className="w-full px-3 py-1.5 text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaved}
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4 text-white" />
              <span>{isSaved ? 'Saved!' : 'Save Bidder Name'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
