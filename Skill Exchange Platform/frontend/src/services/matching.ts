import { Student, MatchScoreResult } from '../types';

/**
 * Normalizes skill strings for robust semantic comparison (e.g. "React & Frontend" matches "React")
 */
function isSkillMatch(skillA: string, skillB: string): boolean {
  const a = skillA.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const b = skillB.toLowerCase().replace(/[^a-z0-9]/g, ' ');

  const wordsA = a.split(/\s+/).filter(w => w.length > 2);
  const wordsB = b.split(/\s+/).filter(w => w.length > 2);

  // Exact substring match
  if (a.includes(b) || b.includes(a)) return true;

  // Keyword overlap
  return wordsA.some(word => wordsB.includes(word));
}

/**
 * Calculates a transparent, formula-based skill compatibility score.
 * Formula breakdown:
 * 1. Skills they can teach you (up to 50%):
 *    - Primary requirement. 40 pts for 1 skill, 50 pts for 2+ skills.
 * 2. Skills you can teach them (up to 30% - Reciprocal bonus):
 *    - 25 pts for 1 skill, 30 pts for 2+ skills.
 * 3. Learning Method Compatibility (up to 10%):
 *    - 10 pts if flexible or matching methods; 5 pts otherwise.
 * 4. Schedule/Availability overlap (up to 10%):
 *    - 10 pts if overlapping schedule periods; 5 pts otherwise.
 */
export function calculateMatchScore(currentUser: Student, candidate: Student): MatchScoreResult {
  // Find skills candidate teaches that current user wants
  const canTeachMe: string[] = [];
  for (const wanted of currentUser.skillsWanted) {
    const match = candidate.skillsOffered.find(offered => isSkillMatch(offered.name, wanted.name));
    if (match && !canTeachMe.includes(match.name)) {
      canTeachMe.push(match.name);
    }
  }

  // Find skills current user teaches that candidate wants
  const canLearnFromMe: string[] = [];
  for (const offered of currentUser.skillsOffered) {
    const match = candidate.skillsWanted.find(wanted => isSkillMatch(offered.name, wanted.name));
    if (match && !canLearnFromMe.includes(offered.name)) {
      canLearnFromMe.push(offered.name);
    }
  }

  let score = 0;

  // 1. Can teach me (0-50 pts)
  if (canTeachMe.length >= 2) {
    score += 50;
  } else if (canTeachMe.length === 1) {
    score += 40;
  }

  // 2. Can learn from me (0-30 pts)
  if (canLearnFromMe.length >= 2) {
    score += 30;
  } else if (canLearnFromMe.length === 1) {
    score += 25;
  }

  // 3. Learning method match (0-10 pts)
  const isMethodFlexible = currentUser.preferredMethod === 'Flexible' || candidate.preferredMethod === 'Flexible';
  const isSameMethod = currentUser.preferredMethod === candidate.preferredMethod;
  if (isMethodFlexible || isSameMethod) {
    score += 10;
  } else {
    score += 5;
  }

  // 4. Availability overlap (0-10 pts)
  const currentAvailStr = currentUser.availability.join(' ').toLowerCase();
  const candidateAvailStr = candidate.availability.join(' ').toLowerCase();
  const hasScheduleOverlap = 
    (currentAvailStr.includes('weekend') && candidateAvailStr.includes('weekend')) ||
    (currentAvailStr.includes('evening') && candidateAvailStr.includes('evening')) ||
    (currentAvailStr.includes('afternoon') && candidateAvailStr.includes('afternoon')) ||
    (currentAvailStr.includes('morning') && candidateAvailStr.includes('morning'));

  if (hasScheduleOverlap) {
    score += 10;
  } else {
    score += 5;
  }

  // Determine reciprocal status and clear label
  const isReciprocal = canTeachMe.length > 0 && canLearnFromMe.length > 0;
  
  let compatibilityLabel: MatchScoreResult['compatibilityLabel'] = 'Complementary Match';
  let explanation = '';

  if (isReciprocal && score >= 80) {
    compatibilityLabel = 'Direct Mutual Match';
    explanation = `High mutual exchange: ${candidate.name.split(' ')[0]} can teach you ${canTeachMe[0]}, and you can teach ${canLearnFromMe[0]} in return.`;
  } else if (isReciprocal) {
    compatibilityLabel = 'Strong Match';
    explanation = `Reciprocal exchange: ${candidate.name.split(' ')[0]} offers ${canTeachMe[0]} and wants ${canLearnFromMe[0]}.`;
  } else if (canTeachMe.length > 0) {
    compatibilityLabel = 'Good Match';
    explanation = `${candidate.name.split(' ')[0]} offers ${canTeachMe.join(', ')} which matches your learning goals.`;
  } else {
    compatibilityLabel = 'Complementary Match';
    explanation = `Complementary academic profile with potential cross-discipline collaboration.`;
    // Base minimum score for general discovery
    if (score === 0) score = 30;
  }

  return {
    student: candidate,
    score: Math.min(100, score),
    canTeachMe,
    canLearnFromMe,
    compatibilityLabel,
    explanation,
    isReciprocal
  };
}
