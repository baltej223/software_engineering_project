# Use Case Diagram

```mermaid
graph LR

  %% =========================
  %% Actors
  %% =========================

  C([Child])
  P([Parent])
  T([Teacher])
  R([Therapist])
  A([Admin])
  D([Device / Edge])
  L([Gemini LLM])

  %% =========================
  %% System Boundary
  %% =========================

  subgraph Atlas["Atlas Personalization Engine"]

    BS((Browse Symbols))
    SS((Select Symbol))
    CS((Compose Sentence))
    RS((Receive Suggestions))

    DR((Draw to Recognize))
    SA((Speak to ASR))
    ED((Emotion Detection))
    SY((Sync Data))

    PD((View Progress Dashboard))
    CV((Configure Vocabulary / Geofence))

    FU((Submit Federated Update))
    MR((Model Retraining and A/B Test))
    MU((Manage Users and Permissions))

  end

  %% =========================
  %% Actor Associations
  %% =========================

  C --- BS
  C --- SS
  C --- RS
  C --- DR
  C --- SA
  C --- ED
  C --- SY

  P --- PD
  P --- CV
  P --- SY

  T --- PD
  T --- CV

  R --- PD
  R --- CV

  D --- FU
  D --- SY

  A --- MU
  A --- MR

  L --- RS

  %% =========================
  %% Include / Extend
  %% =========================

  CS -.->|"include"| SS
  RS -.->|"extend"| ED
  FU -.->|"include"| MR

  %% =========================
  %% Styling
  %% =========================

  classDef actor fill:#f2f8ff,stroke:#0366d6,stroke-width:2px;
  classDef usecase fill:#fff8e6,stroke:#b58900,stroke-width:1.5px;

  class C,P,T,R,A,D,L actor;
  class BS,SS,CS,RS,DR,SA,ED,SY,PD,CV,FU,MR,MU usecase;
```

<img width="1125" height="720" alt="image" src="https://github.com/user-attachments/assets/99e752b2-8b6b-4f03-b8e9-f90e95467462" />

