import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { YearOfStudy, LearningMethod } from '../../types';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const YEARS: YearOfStudy[] = [
  'First Year',
  'Second Year',
  'Third Year',
  'Fourth Year',
  'Graduate / Other'
];

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, updateProfile } = useApp();

  const [name, setName] = useState('');
  const [college, setCollege] = useState('');
  const [department, setDepartment] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState<YearOfStudy>('Third Year');
  const [bio, setBio] = useState('');
  const [preferredMethod, setPreferredMethod] = useState<LearningMethod>('Flexible');
  const [availabilityString, setAvailabilityString] = useState('');
  const [languagesString, setLanguagesString] = useState('');

  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name);
      setCollege(currentUser.college);
      setDepartment(currentUser.department);
      setYearOfStudy(currentUser.yearOfStudy);
      setBio(currentUser.bio);
      setPreferredMethod(currentUser.preferredMethod);
      setAvailabilityString(currentUser.availability.join(', '));
      setLanguagesString(currentUser.languages.join(', '));
    }
  }, [currentUser, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const availability = availabilityString
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const languages = languagesString
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    updateProfile({
      name: name.trim(),
      college: college.trim(),
      department: department.trim(),
      yearOfStudy,
      bio: bio.trim(),
      preferredMethod,
      availability: availability.length > 0 ? availability : ['Flexible'],
      languages: languages.length > 0 ? languages : ['English']
    });

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Student Profile"
      description="Update your academic credentials, learning preferences, and bio."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div>
          <label htmlFor="edit-profile-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Full Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="edit-profile-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
          />
        </div>

        {/* College & Department */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-profile-college" className="block text-xs font-semibold text-slate-700 mb-1.5">
              College / University <span className="text-rose-500">*</span>
            </label>
            <input
              id="edit-profile-college"
              type="text"
              required
              value={college}
              onChange={(e) => setCollege(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
          </div>

          <div>
            <label htmlFor="edit-profile-department" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Major / Department <span className="text-rose-500">*</span>
            </label>
            <input
              id="edit-profile-department"
              type="text"
              required
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
          </div>
        </div>

        {/* Year of study & Preferred Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-profile-year" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Year of Study
            </label>
            <select
              id="edit-profile-year"
              value={yearOfStudy}
              onChange={(e) => setYearOfStudy(e.target.value as YearOfStudy)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            >
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="edit-profile-method" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Preferred Format
            </label>
            <select
              id="edit-profile-method"
              value={preferredMethod}
              onChange={(e) => setPreferredMethod(e.target.value as LearningMethod)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            >
              <option value="Online">Online Video / Screen Share</option>
              <option value="In-person">In-Person Campus</option>
              <option value="Flexible">Flexible / Both</option>
            </select>
          </div>
        </div>

        {/* Bio */}
        <div>
          <label htmlFor="edit-profile-bio" className="block text-xs font-semibold text-slate-700 mb-1.5">
            About You & Learning Interests
          </label>
          <textarea
            id="edit-profile-bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white resize-none"
          />
        </div>

        {/* Availability & Languages */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-profile-availability" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Availability Windows (comma separated)
            </label>
            <input
              id="edit-profile-availability"
              type="text"
              value={availabilityString}
              onChange={(e) => setAvailabilityString(e.target.value)}
              placeholder="e.g. Weekdays Evenings, Weekends"
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
          </div>

          <div>
            <label htmlFor="edit-profile-languages" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Spoken Languages (comma separated)
            </label>
            <input
              id="edit-profile-languages"
              type="text"
              value={languagesString}
              onChange={(e) => setLanguagesString(e.target.value)}
              placeholder="e.g. English, Spanish"
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
          >
            Save Profile
          </button>
        </div>
      </form>
    </Modal>
  );
};
