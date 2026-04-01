import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: '잘못된 요청 방식입니다.' });
  }

  // 프론트엔드에서 처음엔 name을, 동명이인 선택 시엔 pageId를 보냅니다.
  const { name, pageId } = req.body;
  
  if (!name && !pageId) {
    return res.status(400).json({ success: false, message: '이름 또는 ID를 입력해 주세요.' });
  }

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      let targetPage = null;

      if (pageId) {
        // 1-A. 동명이인 모달에서 특정 학과를 '선택'하여 명확한 pageId가 넘어온 경우
        targetPage = await notion.pages.retrieve({ page_id: pageId });
      } else {
        // 1-B. 처음 이름으로 검색한 경우
        const response = await notion.databases.query({
          database_id: DATABASE_ID,
          filter: {
            property: '이름',
            title: { equals: name.trim() },
          },
        });

        if (response.results.length === 0) {
          return res.status(200).json({ success: false, message: '명단에 존재하지 않습니다.' });
        }

        if (response.results.length > 1) {
          // ⭐ 동명이인이 있는 경우: 출석 처리하지 않고 학과 정보만 추출해서 프론트로 반환
          const candidates = response.results.map(page => {
            let dept = "소속 불명";
            // 💡 주의: 노션 데이터베이스의 실제 열 이름에 맞게 '학과'를 수정하세요.
            const deptProp = page.properties['학과']; 
            if (deptProp) {
              if (deptProp.type === 'rich_text' && deptProp.rich_text.length > 0) {
                dept = deptProp.rich_text[0].plain_text;
              } else if (deptProp.type === 'select' && deptProp.select) {
                dept = deptProp.select.name;
              } else if (deptProp.type === 'title' && deptProp.title.length > 0) {
                dept = deptProp.title[0].plain_text;
              }
            }
            return { id: page.id, department: dept };
          });
          
          return res.status(200).json({ 
            success: true, 
            multiple: true, 
            candidates: candidates 
          });
        }

        // 1명만 검색된 경우
        targetPage = response.results[0];
      }

      // --- 여기서부터는 확정된 1명(targetPage)의 출석 처리 로직입니다 ---
      const finalPageId = targetPage.id;

      // 이름 추출 (결과 모달에 표시하기 위함)
      let finalName = name || "참석자";
      const nameProp = targetPage.properties['이름'];
      if (nameProp?.type === 'title' && nameProp.title.length > 0) {
         finalName = nameProp.title[0].plain_text;
      }

      // ⭐ 팀 번호 추출 로직 수정 (Select 유형 대응)
      let teamNumber = "미배정";
      const teamProp = targetPage.properties['팀번호'];
      if (teamProp?.type === 'select' && teamProp.select) {
        // 선택 유형(select)일 경우
        teamNumber = teamProp.select.name.replace('팀', '').trim();
      } else if (teamProp?.type === 'rich_text' && teamProp.rich_text.length > 0) {
        // 혹시 텍스트(rich_text)로 남아있는 경우를 대비한 안전 장치
        teamNumber = teamProp.rich_text[0].plain_text.replace('팀', '').trim(); 
      } 

      // 음료 정보 추출
      let beverageInfo = "미선택";
      const beverageProp = targetPage.properties['음료'];
      if (beverageProp?.type === 'rich_text' && beverageProp.rich_text.length > 0) {
        beverageInfo = beverageProp.rich_text[0].plain_text;
      } else if (beverageProp?.type === 'select' && beverageProp.select) {
        beverageInfo = beverageProp.select.name;
      }

      // 2. 출석 체크박스 업데이트 (최종 출석 완료)
      await notion.pages.update({
        page_id: finalPageId,
        properties: {
          '출석': { checkbox: true },
        },
      });

      // 3. 최종 성공 응답 전송
      return res.status(200).json({ 
        success: true, 
        multiple: false,
        name: finalName,
        team: teamNumber,
        beverage: beverageInfo
      });

    } catch (error) {
      attempt++;
      console.error(`Notion API 에러 (시도 ${attempt}/${MAX_RETRIES}):`, error.message);
      
      if (error.status === 429 || error.status >= 500) {
        if (attempt >= MAX_RETRIES) {
          return res.status(500).json({ success: false, message: '동시 접속자가 많아 지연되고 있습니다. 잠시 후 다시 시도해주세요.' });
        }
        await delay(attempt * 1000); 
      } else {
        return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
      }
    }
  }
}
