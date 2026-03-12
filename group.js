import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, updateDoc, arrayRemove, deleteDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

document.addEventListener("DOMContentLoaded", () => {

const firebaseConfig = {
  apiKey: "AIzaSyBKGufJEWjipBfI77A51M0R7iD5kHpcj3o",
  authDomain: "a-compulsory-challenge.firebaseapp.com",
  projectId: "a-compulsory-challenge",
  storageBucket: "a-compulsory-challenge.firebasestorage.app",
  messagingSenderId: "637088399262",
  appId: "1:637088399262:web:c1128d0b95fe7f7337e08f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const statusEl = document.getElementById("status");
const membersEl = document.getElementById("members");
const fileInput = document.getElementById("fileInput");
const checkinBtn = document.getElementById("checkinBtn");
const ownerActionBtn = document.getElementById("ownerActionBtn");
const leaveGroupBtn = document.getElementById("leaveGroupBtn");
const backBtn = document.getElementById("backBtn");
const photoModal = document.getElementById("photoModal");
const photoViewer = document.getElementById("photoViewer");
const photoBack = document.getElementById("photoBack");

if (photoBack) {
  photoBack.onclick = () => photoModal.style.display = "none";
}
if (backBtn) backBtn.onclick = () => location.href = "/";

function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

onAuthStateChanged(auth, async (user) => {

  if(!user){
    location.href="/";
    return;
  }

  const userRef = doc(db,"users",user.uid);
  let userSnap = await getDoc(userRef);

  if(!userSnap.exists()){
    await setDoc(userRef,{
      uid:user.uid,
      name:user.displayName || "",
      email:user.email || "",
      nickname:user.displayName || "사용자",
      streak:0,
      currentGroupId:null,
      createdAt:serverTimestamp()
    });
    userSnap = await getDoc(userRef);
  }

  const myData = userSnap.data();

  if(!myData.currentGroupId){
    statusEl.textContent="현재 참여 중인 그룹이 없습니다.";
    return;
  }

  const groupId = myData.currentGroupId;
  const groupRef = doc(db,"groups",groupId);
  const groupSnap = await getDoc(groupRef);

  if(!groupSnap.exists()){
    statusEl.textContent="그룹 정보를 찾을 수 없습니다.";
    return;
  }

  const groupData = groupSnap.data();
  membersEl.innerHTML="";
  const members = Array.isArray(groupData.members) ? groupData.members : [];
  const normalizedMode = groupData.mode || (groupData.inviteCode ? "private" : "random");
  const normalizedOwnerUid = groupData.ownerUid || (members.length > 0 ? members[0] : null);
  const normalizedStatus = groupData.status || (normalizedMode === "random" ? "active" : "waiting");
  const isManagedRoom = normalizedMode !== "random";
  const isOwner = normalizedOwnerUid === user.uid;
  const groupStatus = normalizedStatus;
  const challengeLocked = isManagedRoom && groupStatus !== "active";

  const memberElements = [];

  for(const uid of members){

    const memberSnap = await getDoc(doc(db,"users",uid));
    const m = memberSnap.exists() ? memberSnap.data() : null;

    const nickname = m?.nickname || m?.name || "사용자";
    const streak = m?.streak || 0;
    const isMe = uid===user.uid;

    const today = todayStr();
    const checkinSnap = await getDoc(doc(db,"checkins",groupId+"_"+uid+"_"+today));

    let imageURL = null;
    if(checkinSnap.exists()){
      imageURL = checkinSnap.data().imageURL;
    }

    let markClass="wait";
    let markText="⏳ 인증 대기";

    const now=new Date();
    const deadline=new Date();
    deadline.setHours(23,59,59,999);

    if(checkinSnap.exists()){
      markClass="ok";
      markText="⭕ 인증 완료";
    }else if(now>deadline){
      markClass="no";
      markText="❌ 미인증";
    }

    const li=document.createElement("li");
    li.className="item";
    li.innerHTML=
      '<div class="item-left">'+
      '<div class="item-name">'+nickname+'</div>'+
      '<div class="item-sub">'+(isMe?"본인":"그룹원")+'</div>'+
      '<div class="item-streak">🔥 '+streak+'일 연속</div>'+
      '</div>'+
      '<div class="badge '+markClass+'">'+markText+'</div>';

    if(imageURL){
      li.style.cursor="pointer";
      li.onclick=()=>{
        photoViewer.src=imageURL;
        photoModal.style.display="flex";
      };
    }

    const priority =
      markClass==="no" ? 0 :
      markClass==="wait" ? 1 : 2;

    memberElements.push({element:li,priority});
  }

  memberElements
    .sort((a,b)=>a.priority-b.priority)
    .forEach(m=>membersEl.appendChild(m.element));

  if (statusEl) {
    let statusText = "그룹 ID : " + groupId;
    if (isManagedRoom) {
      if (groupStatus === "waiting") {
        statusText += " · 대기실 (" + members.length + "/5)";
      } else if (groupStatus === "active") {
        statusText += " · 진행 중";
      } else {
        statusText += " · 종료됨";
      }
    }
    statusEl.textContent = statusText;
  }

  if (ownerActionBtn) {
    ownerActionBtn.style.display = "none";
    ownerActionBtn.onclick = null;
    ownerActionBtn.classList.remove("danger");

    if (isManagedRoom && isOwner && groupStatus === "waiting") {
      ownerActionBtn.style.display = "block";
      ownerActionBtn.textContent = members.length >= 2 ? "챌린지 시작" : "챌린지 시작 (2명 이상)";
      ownerActionBtn.disabled = members.length < 2;

      ownerActionBtn.onclick = async () => {
        if (!confirm("현재 멤버로 챌린지를 시작할까요?")) return;

        try {
          await runTransaction(db, async (tx) => {
            const latest = await tx.get(groupRef);
            if (!latest.exists()) throw new Error("GROUP_NOT_FOUND");

            const d = latest.data();
            const latestMembers = Array.isArray(d.members) ? d.members : [];
            const mode = d.mode || (d.inviteCode ? "private" : "random");
            const ownerUid = d.ownerUid || (latestMembers.length > 0 ? latestMembers[0] : null);
            const status = d.status || (mode === "random" ? "active" : "waiting");
            const canStart =
              mode !== "random" &&
              ownerUid === user.uid &&
              status === "waiting" &&
              latestMembers.length >= 2 &&
              latestMembers.length <= 5;

            if (!canStart) throw new Error("NOT_STARTABLE");

            tx.update(groupRef, {
              status: "active",
              startedAt: serverTimestamp()
            });
          });

          alert("챌린지가 시작되었습니다.");
          location.reload();
        } catch (err) {
          if (err && err.message === "NOT_STARTABLE") {
            alert("현재 상태에서는 시작할 수 없습니다.");
          } else {
            console.error("startChallenge failed", err);
            alert("챌린지 시작 중 오류가 발생했습니다.");
          }
        }
      };
    } else if (isManagedRoom && isOwner && groupStatus === "active") {
      ownerActionBtn.style.display = "block";
      ownerActionBtn.textContent = "방 해산";
      ownerActionBtn.classList.add("danger");
      ownerActionBtn.disabled = false;

      ownerActionBtn.onclick = async () => {
        if (!confirm("방을 해산하면 모든 멤버가 로비로 이동됩니다. 진행할까요?")) return;

        try {
          await runTransaction(db, async (tx) => {
            const latest = await tx.get(groupRef);
            if (!latest.exists()) throw new Error("GROUP_NOT_FOUND");

            const d = latest.data();
            const latestMembers = Array.isArray(d.members) ? d.members : [];
            const mode = d.mode || (d.inviteCode ? "private" : "random");
            const ownerUid = d.ownerUid || (latestMembers.length > 0 ? latestMembers[0] : null);
            const status = d.status || (mode === "random" ? "active" : "waiting");
            const canDissolve =
              mode !== "random" &&
              ownerUid === user.uid &&
              status === "active";

            if (!canDissolve) throw new Error("NOT_DISSOLVABLE");

            for (const memberUid of latestMembers) {
              tx.set(doc(db, "users", memberUid), {
                currentGroupId: null,
                currentGroupInviteCode: null
              }, { merge: true });
            }

            tx.update(groupRef, {
              status: "closed",
              closedAt: serverTimestamp()
            });
          });

          alert("방이 해산되었습니다.");
          location.href = "/";
        } catch (err) {
          if (err && err.message === "NOT_DISSOLVABLE") {
            alert("현재 상태에서는 해산할 수 없습니다.");
          } else {
            console.error("dissolveRoom failed", err);
            alert("방 해산 중 오류가 발생했습니다.");
          }
        }
      };
    }
  }

  if(checkinBtn){
    const date = todayStr();
    const todayCheckinRef = doc(db,"checkins",groupId+"_"+user.uid+"_"+date);
    const storageRef = ref(storage,"checkins/"+groupId+"/"+user.uid+"_"+date+".jpg");
    const myTodaySnap = await getDoc(todayCheckinRef);
    const hasMyTodayCheckin = myTodaySnap.exists();
    const fileBox = fileInput ? fileInput.closest(".file") : null;

    if (challengeLocked) {
      checkinBtn.textContent = "대기실: 방장 시작 대기";
      if (groupStatus === "closed") {
        checkinBtn.textContent = "종료된 방입니다";
      }
      checkinBtn.disabled = true;
      if (fileInput) fileInput.disabled = true;
      if (fileBox) fileBox.style.opacity = "0.6";
    } else {
      checkinBtn.disabled = false;
      if (fileInput) fileInput.disabled = false;
      if (fileBox) fileBox.style.opacity = "1";
    }

    if (!challengeLocked && hasMyTodayCheckin) {
      checkinBtn.textContent = "사진 변경/삭제";

      checkinBtn.onclick = async () => {
        const willChange = confirm("확인을 누르면 사진 변경, 취소를 누르면 삭제 선택으로 이동합니다.");

        if (willChange) {
          if (!fileInput || !fileInput.files[0]) {
            alert("변경할 사진을 먼저 선택해 주세요.");
            return;
          }

          const file = fileInput.files[0];
          await uploadBytes(storageRef, file);
          const imageURL = await getDownloadURL(storageRef);

          await updateDoc(todayCheckinRef, {
            imageURL,
            updatedAt: serverTimestamp()
          });

          alert("오늘 인증 사진이 변경되었습니다.");
          location.reload();
          return;
        }

        const willDelete = confirm("오늘 인증을 취소(삭제)하시겠습니까?");
        if (!willDelete) return;

        try {
          await deleteObject(storageRef);
        } catch (_) {
          // Storage 객체가 이미 없는 경우는 무시
        }

        await deleteDoc(todayCheckinRef);

        const latestUserSnap = await getDoc(userRef);
        const currentStreak = latestUserSnap.exists() ? (latestUserSnap.data().streak || 0) : 0;
        await updateDoc(userRef, { streak: Math.max(currentStreak - 1, 0) });

        alert("오늘 인증이 취소되었습니다.");
        location.reload();
      };
    } else if (!challengeLocked) {
      checkinBtn.textContent = "오늘 인증하기";

      checkinBtn.onclick=async()=>{
        if(!fileInput || !fileInput.files[0]){
          alert("먼저 인증 사진을 선택해 주세요.");
          return;
        }

        const file=fileInput.files[0];
        const todayCheckinSnap = await getDoc(todayCheckinRef);

        if (todayCheckinSnap.exists()) {
          alert("오늘은 이미 인증이 완료되었습니다.");
          return;
        }

        await uploadBytes(storageRef,file);
        const imageURL=await getDownloadURL(storageRef);

        await setDoc(todayCheckinRef,{
          groupId,
          uid:user.uid,
          date,
          imageURL,
          createdAt:serverTimestamp()
        });

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate()-1);
        const yStr = yesterday.toISOString().slice(0,10);

        const ySnap = await getDoc(doc(db,"checkins",groupId+"_"+user.uid+"_"+yStr));

        let newStreak = 1;
        if(ySnap.exists()){
          newStreak = (myData.streak || 0) + 1;
        }

        await updateDoc(userRef,{streak:newStreak});

        alert("오늘 인증이 완료되었습니다.");
        location.reload();
      };
    }
  }

  if(leaveGroupBtn){
    leaveGroupBtn.textContent = isOwner && isManagedRoom ? "방 나가기(방장)" : "그룹 나가기";
    leaveGroupBtn.onclick=async()=>{
      if(!confirm("정말로 그룹에서 나가시겠습니까?")) return;

      await updateDoc(groupRef,{members:arrayRemove(user.uid)});
      await updateDoc(userRef,{currentGroupId:null, currentGroupInviteCode:null});

      alert("그룹에서 나가셨습니다.");
      location.href="/";
    };
  }

});

});
