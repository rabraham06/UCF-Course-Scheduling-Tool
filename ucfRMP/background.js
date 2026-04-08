// Search RMP HTML and scrape first professor result from UCF only
async function searchProfessor(name) {
    const UCF_SCHOOL_ID = "1443"; // UCF's RateMyProfessors school ID
    const searchURL =
        "https://www.ratemyprofessors.com/search/professors/" + UCF_SCHOOL_ID + "?q=" +
        encodeURIComponent(name);

    try {
        const res = await fetch(searchURL, { method: "GET" });
        const html = await res.text();

        // Extract professor IDs from search results
        // Try to extract school info from search results page first
        const professorMatches = [...html.matchAll(/\/professor\/(\d+)/g)];
        if (professorMatches.length === 0) return null;

        // Extract unique professor IDs
        const uniqueProfIDs = [...new Set(professorMatches.map(m => m[1]))];
        
        // Try to find school IDs associated with each professor in search results
        // Look for patterns like: "schoolId":1443 near professor links or in JSON data
        const profSchoolMap = new Map();
        
        // Try to extract from JSON data structures in the page
        // Look for schoolId and professor ID in close proximity
        const jsonPattern1 = /"schoolId"\s*:\s*(\d+)[\s\S]{0,500}?\/professor\/(\d+)/g;
        const jsonPattern2 = /\/professor\/(\d+)[\s\S]{0,500}?"schoolId"\s*:\s*(\d+)/g;
        
        for (const match of html.matchAll(jsonPattern1)) {
            if (match[1] && match[2]) {
                profSchoolMap.set(match[2], match[1]);
            }
        }
        
        for (const match of html.matchAll(jsonPattern2)) {
            if (match[1] && match[2]) {
                profSchoolMap.set(match[1], match[2]);
            }
        }
        
        // Also try a broader search around each professor ID
        for (const profID of uniqueProfIDs) {
            if (!profSchoolMap.has(profID)) {
                // Look for school ID within 500 characters of professor link
                const profIndex = html.indexOf(`/professor/${profID}`);
                if (profIndex !== -1) {
                    const context = html.substring(Math.max(0, profIndex - 200), Math.min(html.length, profIndex + 500));
                    const schoolIdMatch = context.match(/"schoolId"\s*:\s*(\d+)/);
                    if (schoolIdMatch) {
                        profSchoolMap.set(profID, schoolIdMatch[1]);
                    }
                }
            }
        }

        // Try each professor until we find one from UCF
        // Verify each one is from UCF before returning
        for (let i = 0; i < uniqueProfIDs.length; i++) {
            const profID = uniqueProfIDs[i];
            
            // Pre-filter: Check if we found school ID in search results
            const searchResultSchoolId = profSchoolMap.get(profID);
            if (searchResultSchoolId && searchResultSchoolId !== UCF_SCHOOL_ID) {
                // Found in search results that this professor is not from UCF, skip
                continue;
            }
            
            const profileURL = "https://www.ratemyprofessors.com/professor/" + profID;

            // Fetch profile page to verify school and get rating
            const profRes = await fetch(profileURL);
            const profHTML = await profRes.text();

            // Verify the professor's name matches (case-insensitive, flexible matching)
            const searchNameLower = name.toLowerCase().trim();
            const nameParts = searchNameLower.split(/\s+/).filter(p => p.length > 0);
            
            // Try to find professor name in the HTML
            let nameMatches = false;
            const namePatterns = [
                /"firstName"\s*:\s*"([^"]+)"[^}]*"lastName"\s*:\s*"([^"]+)"/i,
                /"name"\s*:\s*"([^"]+)"/i,
                /<h1[^>]*>([^<]+)<\/h1>/i,
                /class="NameTitle__Name"[^>]*>([^<]+)</i,
                /<title>([^<]+)<\/title>/i,
                /Professor\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
                /"firstName":"([^"]+)","lastName":"([^"]+)"/i
            ];
            
            for (const pattern of namePatterns) {
                const match = profHTML.match(pattern);
                if (match) {
                    let profName = "";
                    if (match[1] && match[2]) {
                        // First and last name separate
                        profName = `${match[1]} ${match[2]}`.toLowerCase().trim();
                    } else if (match[1]) {
                        // Full name
                        profName = match[1].toLowerCase().trim();
                        // Remove common prefixes/suffixes
                        profName = profName.replace(/^(professor|dr\.?|dr)\s+/i, '').trim();
                    }
                    
                    if (profName) {
                        const profNameParts = profName.split(/\s+/).filter(p => p.length > 0);
                        
                        // More lenient matching: check if key name parts match
                        // For 2-part names (first last), both parts should match
                        // For 3+ part names, at least first and last should match
                        if (nameParts.length >= 2 && profNameParts.length >= 2) {
                            // Check if first and last name parts match
                            const firstMatches = nameParts[0] === profNameParts[0] || 
                                                nameParts[0].includes(profNameParts[0]) || 
                                                profNameParts[0].includes(nameParts[0]);
                            const lastMatches = nameParts[nameParts.length - 1] === profNameParts[profNameParts.length - 1] ||
                                               nameParts[nameParts.length - 1].includes(profNameParts[profNameParts.length - 1]) ||
                                               profNameParts[profNameParts.length - 1].includes(nameParts[nameParts.length - 1]);
                            
                            if (firstMatches && lastMatches) {
                                nameMatches = true;
                                break;
                            }
                        }
                        
                        // Fallback: check if all search name parts appear in professor name
                        const allPartsMatch = nameParts.every(searchPart => 
                            profNameParts.some(profPart => 
                                profPart.includes(searchPart) || searchPart.includes(profPart) ||
                                profPart === searchPart
                            )
                        );
                        
                        if (allPartsMatch && nameParts.length > 0) {
                            nameMatches = true;
                            break;
                        }
                    }
                }
            }
            
            // Note: We'll check name matching later, but don't skip yet
            // If school verification passes, we'll be more lenient with name matching

            // Check if this professor is from UCF by looking for school ID in the HTML
            // STRICT: Must find UCF school ID (1443), reject if any non-UCF school ID found
            let isUCF = false;
            let foundSchoolInfo = false;
            let foundNonUCFSchool = false;
            
            // Pattern 1: Look for schoolId in JSON (most reliable)
            // Find ALL school IDs to check for conflicts
            // Try multiple patterns to catch different JSON structures
            const allSchoolIds = new Set();
            let match;
            
            const schoolIdPatterns = [
                /"schoolId"\s*:\s*(\d+)/g,
                /schoolId["\s]*:[\s]*(\d+)/g,
                /"sid":\s*(\d+)/g,
                /sid["\s]*:[\s]*(\d+)/g,
                /"schoolId":\s*(\d+)/g,
                /schoolId:\s*(\d+)/g,
                /"school"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/g,
                /"institutionId"\s*:\s*(\d+)/g,
                /institutionId["\s]*:[\s]*(\d+)/g
            ];
            
            for (const pattern of schoolIdPatterns) {
                while ((match = pattern.exec(profHTML)) !== null) {
                    if (match[1]) {
                        allSchoolIds.add(match[1]);
                    }
                }
            }
            
            // Check what we found
            if (allSchoolIds.size > 0) {
                foundSchoolInfo = true;
                
                // Check if UCF is in the set
                if (allSchoolIds.has(UCF_SCHOOL_ID)) {
                    // UCF found - accept it (since we're searching within UCF school ID 1443)
                    // Even if there are other schools, if UCF is present, accept it
                    isUCF = true;
                } else {
                    // No UCF found, only non-UCF
                    foundNonUCFSchool = true;
                }
            }
            
            // If we found non-UCF school and UCF is not primary, skip
            if (foundNonUCFSchool && !isUCF) {
                continue;
            }
            
            // If we verified UCF, continue to rating extraction
            if (isUCF) {
                // Continue below
            } else if (!foundSchoolInfo) {
                // Pattern 2: Look for school name (less reliable, but still check)
                const schoolNamePatterns = [
                    /"schoolName"\s*:\s*"([^"]+)"/,
                    /schoolName["\s]*:[\s]*"([^"]+)"/,
                    /"school":\s*"([^"]+)"/,
                    /"institution":\s*"([^"]+)"/
                ];
                
                for (const pattern of schoolNamePatterns) {
                    const match = profHTML.match(pattern);
                    if (match && match[1]) {
                        foundSchoolInfo = true;
                        const schoolName = match[1].toLowerCase();
                        // Check for UCF indicators
                        if (schoolName.includes("central florida") || 
                            schoolName.includes("university of central florida") ||
                            schoolName === "ucf" ||
                            schoolName.startsWith("ucf")) {
                            isUCF = true;
                            break;
                        } else {
                            // Found school name but it's not UCF
                            // Only mark as non-UCF if we haven't already verified UCF via school ID
                            if (!isUCF) {
                                foundNonUCFSchool = true;
                            }
                            break;
                        }
                    }
                }
                
                // Only skip if we found non-UCF and haven't verified UCF
                if (foundNonUCFSchool && !isUCF) {
                    continue; // Skip this professor, not from UCF
                }
                
                // Pattern 3: Look for UCF mentions in the page text (as fallback verification)
                if (!foundSchoolInfo) {
                    const ucfMention = profHTML.match(/University of Central Florida|\bUCF\b/i);
                    if (ucfMention) {
                        isUCF = true;
                        foundSchoolInfo = true;
                    }
                }
            }

            // If we explicitly found a non-UCF school and UCF is not verified, skip
            if (foundNonUCFSchool && !isUCF) {
                continue;
            }
            
            // Verification logic:
            // 1. If we verified UCF school, accept it (name matching is preferred but not required if school is verified)
            // 2. If we found school info but couldn't verify UCF, skip
            // 3. If we can't find school info, skip (require verification)
            if (isUCF) {
                // Verified UCF school - accept even if name matching failed
                // (since we searched within UCF, the first result is likely correct)
                // Name matching is a bonus check but not required if school is verified
            } else if (foundSchoolInfo && !isUCF) {
                // Found school info but it's not UCF, skip
                continue;
            } else {
                // Can't verify school, skip (require explicit verification)
                continue;
            }
            
            // Found a verified UCF professor, extract rating data
            // Try multiple patterns for rating
            const ratingPatterns = [
                /"avgRating"\s*:\s*(\d+\.?\d*)/,
                /avgRating["\s]*:[\s]*(\d+\.?\d*)/,
                /"averageRating"\s*:\s*(\d+\.?\d*)/
            ];
            
            let ratingMatch = null;
            for (const pattern of ratingPatterns) {
                ratingMatch = profHTML.match(pattern);
                if (ratingMatch) break;
            }
            
            const numPatterns = [
                /"numRatings"\s*:\s*(\d+)/,
                /numRatings["\s]*:[\s]*(\d+)/,
                /"numberOfRatings"\s*:\s*(\d+)/
            ];
            
            let numMatch = null;
            for (const pattern of numPatterns) {
                numMatch = profHTML.match(pattern);
                if (numMatch) break;
            }

            const numRatings = numMatch ? parseInt(numMatch[1], 10) : 0;
            
            // If there are 0 ratings, return N/A for rating
            const rating = (numRatings === 0 || !ratingMatch) ? "N/A" : ratingMatch[1];

            return {
                ok: true,
                rating: rating,
                numRatings: numRatings.toString(),
                profileUrl: profileURL
            };
        }

        // No UCF professor found
        return null;
    } catch (err) {
        console.error("SCRAPER ERROR:", err);
        return { ok: false };
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "lookupRMP") return;

    searchProfessor(msg.name).then(sendResponse);

    return true; // keeps message channel open for async response
});
