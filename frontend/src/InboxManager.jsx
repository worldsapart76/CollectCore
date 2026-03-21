import { useEffect, useState } from "react";
import { getMembersForGroup } from "./utils/groupUtils";
import {
  fetchInbox,
  fetchSubcategoryOptions,
  fetchSourceOptions,
  ingestFront,
  fetchCardCandidates,
  attachBack,
} from "./api";

const API = "http://127.0.0.1:8000";

export default function InboxManager() {
  const [files, setFiles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [mode, setMode] = useState("front");

  const [groupCode, setGroupCode] = useState("skz");
  const [member, setMember] = useState("");
  const [topCategory, setTopCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [subcategoryOptions, setSubcategoryOptions] = useState([]);

  const [version, setVersion] = useState("");
  const [versionOptions, setVersionOptions] = useState([]);

  const [ownershipStatus, setOwnershipStatus] = useState("Owned");
  const [price, setPrice] = useState("");

  const [includeCardsWithBack, setIncludeCardsWithBack] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);

  const [message, setMessage] = useState("");
  const [warningData, setWarningData] = useState(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const memberOptions = getMembersForGroup(groupCode);

  function clearTransientState() {
    setCandidates([]);
    setSelectedCandidateId(null);
    setMessage("");
    setWarningData(null);
  }

  async function loadInbox() {
    const data = await fetchInbox();
    const newFiles = data.files || [];
    setFiles(newFiles);

    if (newFiles.length === 0) {
      setCurrentIndex(0);
    } else if (currentIndex > newFiles.length - 1) {
      setCurrentIndex(newFiles.length - 1);
    }
  }

async function loadSubcategories(category) {
  if (!category || !groupCode) {
    setSubcategoryOptions([]);
    return;
  }

  const data = await fetchSubcategoryOptions(groupCode, category);
  setSubcategoryOptions(data);
}

  async function loadVersionOptions(category, subcat) {
    if (!category || !subcat) {
      setVersionOptions([]);
      return;
    }

    try {
      const data = await fetchSourceOptions(category, subcat);
      setVersionOptions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setVersionOptions([]);
    }
  }

  async function loadCandidates() {
    if (mode !== "back") {
      setCandidates([]);
      return;
    }

    if (!member || !topCategory || !subcategory) {
      setCandidates([]);
      return;
    }

    setLoadingCandidates(true);
    try {
      const data = await fetchCardCandidates({
        groupCode,
        member,
        topLevelCategory: topCategory,
        subCategory: subcategory,
        includeCardsWithBack,
      });
      setCandidates(data);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function saveFront() {
    const current = files[currentIndex];
    if (!current) return;

    if (!member || !topCategory || !subcategory) {
      setMessage("Please select group, member, top category, and subcategory first.");
      return;
    }

    setMessage("");

    await ingestFront({
      filename: current.filename,
      groupCode,
      member,
      topLevelCategory: topCategory,
      subCategory: subcategory,
      version,
      ownershipStatus,
      price: price === "" ? "" : Number(price),
    });

    await loadInbox();
    clearTransientState();
  }

  async function saveBack(forceReplace = false) {
    const current = files[currentIndex];
    if (!current) return;

    if (!selectedCandidateId) {
      setMessage("Please select a matching front card first.");
      return;
    }

    setMessage("");

    const result = await attachBack({
      cardId: selectedCandidateId,
      filename: current.filename,
      forceReplace,
    });

    if (result.needs_confirmation) {
      setWarningData(result);
      setMessage(result.message);
      return;
    }

    setWarningData(null);
    await loadInbox();
    clearTransientState();
  }

  function goPrevious() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      clearTransientState();
    }
  }

  function goNext() {
    if (currentIndex < files.length - 1) {
      setCurrentIndex(currentIndex + 1);
      clearTransientState();
    }
  }

  function handleGroupChange(nextGroupCode) {
    setGroupCode(nextGroupCode);
    setMember("");
    setTopCategory("");
    setSubcategory("");
    setSubcategoryOptions([]);
    setVersion("");
    setVersionOptions([]);
    clearTransientState();
  }

  useEffect(() => {
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSubcategories(topCategory);
  }, [topCategory, groupCode]);

  useEffect(() => {
    loadVersionOptions(topCategory, subcategory);
  }, [topCategory, subcategory]);

  useEffect(() => {
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, groupCode, member, topCategory, subcategory, includeCardsWithBack]);

  const current = files[currentIndex];

  const sectionTitleStyle = {
    marginTop: 0,
    marginBottom: 4,
    fontSize: 15,
    fontWeight: 700,
  };

  const buttonStyle = {
    padding: "2px 8px",
    fontSize: 13,
  };

  return (
    <div style={{ padding: 10, fontSize: 13 }}>
      {!current && <p style={{ marginTop: 0 }}>No images in inbox.</p>}

      {current && (
        <>
          <div style={{ marginBottom: 6, fontSize: 13 }}>
            <strong>
              Image {currentIndex + 1} of {files.length}
            </strong>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 14,
            }}
          >
            <div style={{ flex: "0 0 300px" }}>
              <img
                src={`${API}${current.url}`}
                alt={current.filename}
                style={{
                  width: "100%",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  border: "1px solid #ccc",
                }}
              />

              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <button
                    onClick={goPrevious}
                    disabled={currentIndex === 0}
                    style={buttonStyle}
                  >
                    Previous
                  </button>

                  <button
                    onClick={goNext}
                    disabled={currentIndex === files.length - 1}
                    style={buttonStyle}
                  >
                    Next
                  </button>
                </div>

                <div>
                  <div style={{ fontWeight: "bold", marginBottom: 4, fontSize: 14 }}>Mode</div>

                  <button
                    onClick={() => {
                      setMode("front");
                      clearTransientState();
                    }}
                    style={{
                      ...buttonStyle,
                      marginRight: 6,
                      background: mode === "front" ? "#88f" : "#eee",
                    }}
                  >
                    Front
                  </button>

                  <button
                    onClick={() => {
                      setMode("back");
                      clearTransientState();
                    }}
                    style={{
                      ...buttonStyle,
                      background: mode === "back" ? "#88f" : "#eee",
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <h3 style={sectionTitleStyle}>Group</h3>

              <div style={{ marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => handleGroupChange("skz")}
                  style={{
                    ...buttonStyle,
                    background: groupCode === "skz" ? "#88f" : "#eee",
                  }}
                >
                  Stray Kids
                </button>

                <button
                  type="button"
                  onClick={() => handleGroupChange("atz")}
                  style={{
                    ...buttonStyle,
                    background: groupCode === "atz" ? "#88f" : "#eee",
                  }}
                >
                  ATEEZ
                </button>

                <button
                  type="button"
                  onClick={() => handleGroupChange("txt")}
                  style={{
                    ...buttonStyle,
                    background: groupCode === "txt" ? "#88f" : "#eee",
                  }}
                >
                  TXT
                </button>
              </div>

              <h3 style={sectionTitleStyle}>Member</h3>

              <div style={{ marginBottom: 10 }}>
                {memberOptions.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMember(m);
                      clearTransientState();
                    }}
                    style={{
                      ...buttonStyle,
                      margin: 2,
                      background: member === m ? "#88f" : "#eee",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 24,
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  marginBottom: 10,
                }}
              >
                <div>
                  <h3 style={sectionTitleStyle}>Top Category</h3>

                  <div>
                    <button
                      onClick={() => {
                        setTopCategory("Album");
                        setSubcategory("");
                        setVersion("");
                        setVersionOptions([]);
                        clearTransientState();
                      }}
                      style={{
                        ...buttonStyle,
                        marginRight: 6,
                        background: topCategory === "Album" ? "#88f" : "#eee",
                      }}
                    >
                      Album
                    </button>

                    <button
                      onClick={() => {
                        setTopCategory("Non-Album");
                        setSubcategory("");
                        setVersion("");
                        setVersionOptions([]);
                        clearTransientState();
                      }}
                      style={{
                        ...buttonStyle,
                        background: topCategory === "Non-Album" ? "#88f" : "#eee",
                      }}
                    >
                      Non-Album
                    </button>
                  </div>
                </div>

                <div>
                  <h3 style={sectionTitleStyle}>Ownership Status</h3>

                  <div>
                    <button
                      onClick={() => setOwnershipStatus("Owned")}
                      style={{
                        ...buttonStyle,
                        marginRight: 6,
                        background: ownershipStatus === "Owned" ? "#88f" : "#eee",
                      }}
                    >
                      Owned
                    </button>

                    <button
                      onClick={() => setOwnershipStatus("Want")}
                      style={{
                        ...buttonStyle,
                        marginRight: 6,
                        background: ownershipStatus === "Want" ? "#88f" : "#eee",
                      }}
                    >
                      Want
                    </button>

                    <button
                      onClick={() => setOwnershipStatus("For Trade")}
                      style={{
                        ...buttonStyle,
                        background: ownershipStatus === "For Trade" ? "#88f" : "#eee",
                      }}
                    >
                      For Trade
                    </button>
                  </div>
                </div>
              </div>

              {topCategory && (
                <>
                  <h3 style={sectionTitleStyle}>Sub Category</h3>

                  <div style={{ marginBottom: 6 }}>
                    {subcategoryOptions.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => {
                          setSubcategory(opt);
                          setVersion("");
                          clearTransientState();
                        }}
                        style={{
                          ...buttonStyle,
                          margin: 2,
                          background: subcategory === opt ? "#88f" : "#eee",
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <input
                      placeholder="Or type new value"
                      value={subcategory}
                      onChange={(e) => {
                        setSubcategory(e.target.value);
                        setVersion("");
                        clearTransientState();
                      }}
                      style={{ padding: 4, width: 250, fontSize: 13 }}
                    />
                  </div>

                  <h3 style={sectionTitleStyle}>Version</h3>

                  <div style={{ marginBottom: 10 }}>
                    <input
                      type="text"
                      list="inbox-version-options"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="Optional"
                      style={{ padding: 4, width: 250, fontSize: 13 }}
                    />
                    <datalist id="inbox-version-options">
                      {versionOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </div>
                </>
              )}

              <h3 style={sectionTitleStyle}>Price</h3>

              <div style={{ marginBottom: 10 }}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Optional"
                  style={{ padding: 4, width: 120, fontSize: 13 }}
                />
              </div>

              {mode === "back" && (
                <>
                  <h3 style={sectionTitleStyle}>Matching Front Cards</h3>

                  <label style={{ display: "block", marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={includeCardsWithBack}
                      onChange={(e) => {
                        setIncludeCardsWithBack(e.target.checked);
                        setSelectedCandidateId(null);
                        setWarningData(null);
                      }}
                    />{" "}
                    Show all cards, including ones that already have a back
                  </label>

                  {!member || !topCategory || !subcategory ? (
                    <p style={{ color: "#666", marginTop: 0 }}>
                      Select member, top category, and subcategory to load candidate front cards.
                    </p>
                  ) : loadingCandidates ? (
                    <p style={{ marginTop: 0 }}>Loading matching cards...</p>
                  ) : candidates.length === 0 ? (
                    <p style={{ marginTop: 0 }}>No matching front cards found.</p>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                        gap: 8,
                        marginBottom: 10,
                        maxHeight: "38vh",
                        overflowY: "auto",
                        paddingRight: 4,
                      }}
                    >
                      {candidates.map((card) => (
                        <button
                          key={card.id}
                          onClick={() => {
                            setSelectedCandidateId(card.id);
                            setWarningData(null);
                            setMessage("");
                          }}
                          style={{
                            border:
                              selectedCandidateId === card.id
                                ? "3px solid #4a67ff"
                                : "1px solid #ccc",
                            borderRadius: 8,
                            padding: 4,
                            background: "#fff",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <img
                            src={`${API}${card.front_url}`}
                            alt={`Card ${card.id}`}
                            style={{
                              width: "100%",
                              aspectRatio: "55 / 85",
                              objectFit: "cover",
                              borderRadius: 4,
                              marginBottom: 4,
                            }}
                          />

                          <div style={{ fontSize: 11, lineHeight: 1.25 }}>
                            <div>
                              <strong>ID:</strong> {card.id}
                            </div>
                            <div>{card.member || "—"}</div>
                            <div>{card.sub_category || "—"}</div>
                            <div style={{ color: card.has_back ? "#b00" : "#090" }}>
                              {card.has_back ? "Already has back" : "No back yet"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {message && (
                <div
                  style={{
                    marginBottom: 8,
                    padding: 8,
                    border: "1px solid #ccc",
                    background: "#f8f8f8",
                    fontSize: 13,
                  }}
                >
                  {message}
                </div>
              )}

              {warningData && (
                <div
                  style={{
                    marginBottom: 8,
                    padding: 8,
                    border: "1px solid #d99",
                    background: "#fff3f3",
                    fontSize: 13,
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    This card already has a back image.
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => {
                        setWarningData(null);
                        setMessage("");
                      }}
                      style={buttonStyle}
                    >
                      Cancel
                    </button>

                    <button onClick={() => saveBack(true)} style={buttonStyle}>
                      Replace Anyway
                    </button>
                  </div>
                </div>
              )}

              {mode === "front" ? (
                <button onClick={saveFront} style={{ padding: "4px 10px", fontSize: 13 }}>
                  Save Front and Next
                </button>
              ) : (
                <button onClick={() => saveBack(false)} style={{ padding: "4px 10px", fontSize: 13 }}>
                  Attach Back and Next
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}