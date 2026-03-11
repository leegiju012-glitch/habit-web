import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, updateDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const leaveGroupBtn = document.getElementById("leaveGroupBtn");
const backBtn = document.getElementById("backBtn");
const nicknameInput = document.getElementById("nicknameInput");
const saveNickBtn = document.getElementById("saveNickBtn");
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

  if (nicknameInput) {
    nicknameInput.value = myData.nickname || myData.name || "";
  }

  if (saveNickBtn && nicknameInput) {
    saveNickBtn.onclick = async () => {
      const nickname = nicknameInput.value.trim();

      if (nickname.length < 2 || nickname.length > 10) {
        alert("닉네임은 2~10자로 입력해 주세요.");
        return;
      }

      await updateDoc(userRef, { nickname });
      alert("닉네임이 변경되었습니다.");
      location.reload();
    };
  }

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

  statusEl.textContent="그룹 ID : "+groupId;

  const groupData = groupSnap.data();
  membersEl.innerHTML="";

  const memberElements = [];

  for(const uid of groupData.members){

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

  if(checkinBtn){
    checkinBtn.onclick=async()=>{
      if(!fileInput || !fileInput.files[0]){
        alert("먼저 인증 사진을 선택해 주세요.");
        return;
      }

      const file=fileInput.files[0];
      const date=todayStr();
      const todayCheckinRef = doc(db,"checkins",groupId+"_"+user.uid+"_"+date);
      const todayCheckinSnap = await getDoc(todayCheckinRef);

      if (todayCheckinSnap.exists()) {
        alert("오늘은 이미 인증이 완료되었습니다.");
        return;
      }

      const storageRef=ref(storage,"checkins/"+groupId+"/"+user.uid+"_"+date+".jpg");

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

  if(leaveGroupBtn){
    leaveGroupBtn.onclick=async()=>{
      if(!confirm("정말로 그룹에서 나가시겠습니까?")) return;

      await updateDoc(groupRef,{members:arrayRemove(user.uid)});
      await updateDoc(userRef,{currentGroupId:null});

      alert("그룹에서 나가셨습니다.");
      location.href="/";
    };
  }

});

});
