(() => {
  console.log("UCF RMP Helper injected:", window.location.href);

  function injectRatings() {
    const spans = document.querySelectorAll(
      'span.PSLONGEDITBOX[id^="MTG_INSTR"]'
    );

    spans.forEach(span => {
      let name = span.innerText.trim();
      if (!name) return;

      name = name.replace(/to be announced/gi, "").trim();

      // If multiple professors are listed (comma-separated), use only the first one
      // Split by comma and take the first name, also handle newlines
      const nameParts = name.split(/[,\n]/);

      if (nameParts.length > 0) {
        name = nameParts[0].trim();
      }
      
      if (!name) return;

      if (span.dataset.rmpDone === "true") return;
      span.dataset.rmpDone = "true";

      // Create a container div to hold the rating link below the name
      const container = document.createElement("div");
      container.style.display = "block";
      container.style.marginTop = "2px";
      
      const link = document.createElement("a");
      link.textContent = "RMP: Loading…";
      link.href = "#";
      link.style.textDecoration = "none";
      link.style.fontSize = "11px";
      link.style.fontWeight = "bold";
      link.style.color = "#555";
      link.style.display = "block";
      link.onclick = (e) => {
        e.preventDefault();
        // Will be updated when rating is fetched
      };
      
      container.appendChild(link);
      span.insertAdjacentElement("afterend", container);

      chrome.runtime.sendMessage(
        { type: "lookupRMP", name },
        res => {
          if (!res || !res.ok) {
            link.textContent = "RMP: N/A";
            link.style.color = "#888";
            link.href = "#";
            link.onclick = (e) => e.preventDefault();
            return;
          }

          const rating = parseFloat(res.rating);
          let ratingText = `RMP: ${res.rating}/5.0 (${res.numRatings} ratings)`;
          
          if (!isNaN(rating)) {
            if (rating >= 4.5 && res.numRatings > 10) link.style.color = "#00aeffff"; 
            else if(rating >= 3.5) link.style.color = "#22d811ff"
            else if (rating >= 3) link.style.color = "#ff9800"; 
            else if(rating >= 2.0) link.style.color = "#dc3545"; 
            else link.style.color = "#000000ff";
          } 
          else {
            link.style.color = "#888";
          }

          link.textContent = ratingText;
          link.href = res.profileUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.title = "View on RateMyProfessors";
          link.onclick = (e) => {
            e.preventDefault();
            window.open(res.profileUrl, "_blank");
          };
        }
      );
    });
  }

  injectRatings();

  new MutationObserver(injectRatings).observe(document.body, {
    childList: true,
    subtree: true
  });
})();
