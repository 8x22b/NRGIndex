/* NRG/INDEX — ключи входа и конфиг ИИ.
 * АДМИНКА: это файл и есть админка.
 * - Чтобы выдать доступ: скопируй человеку его ключ (поле key ниже видят только
 *   те, у кого есть доступ к репозиторию — храни их соответственно).
 * - Ник и подпись назначаются ЗДЕСЬ (поля name/role). Участник сам их менять
 *   не может — в кабинете этих полей нет.
 * - Новый участник: добавь запись { hash, pid, name, role }. Хэш ключа посчитай:
 *   node -e "console.log(require('crypto').createHash('sha256').update('NRG-...').digest('hex'))"
 * - OpenRouter-ключ лежит ниже в NRG_AI.key — один на всех, устройства
 *   подхватывают его автоматически. */
window.NRG_KEYS = [
  {
    key: "NRG-B7B56F-ED0E19-E41F39",
    hash: "20ad09f7dd834f07b76565c6ec19c0bbf333d41aefc6cf23e007a586fb3794bb",
    pid: "sanya",
  },
  {
    key: "NRG-4DF8DA-5678F0-161176",
    hash: "c7df208f89a378b57d56a802c4e6575c0d0e460fc08f12315eb06e0e77cad550",
    pid: "yarik",
  },
  {
    key: "NRG-D47EEB-B87EC3-DD7488",
    hash: "f7c8beb849af647f050f43b132d9545948d6717906dd2f7e62f295bbe7f0f288",
    pid: "roma",
  },
  {
    key: "NRG-914D2B-318F63-9965DE",
    hash: "05fae7d17a71e94e9f869adb7bf646e26f817401041c89680727205b59d55176",
    pid: "person-4",
    name: "Участник 4",
    role: "место свободно",
  },
  {
    key: "NRG-3CB8B0-A8E338-FE323A",
    hash: "b54271c9115cd65d00751001f4dcb78a1a4051af3cb3c2fa071578cf584b5ec5",
    pid: "person-5",
    name: "Участник 5",
    role: "место свободно",
  },
];

/* OpenRouter: ключ один на всех. Модель меняется одной строкой. */
window.NRG_AI = {
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  model: "openai/gpt-4o-mini",
  key: "",
};
