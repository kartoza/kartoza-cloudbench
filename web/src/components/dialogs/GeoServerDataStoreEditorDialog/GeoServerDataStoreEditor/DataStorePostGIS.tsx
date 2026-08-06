import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState
} from 'react'
import {
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
} from '@chakra-ui/react'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import { PGEditorMode, PGEditorModeType } from "../types.ts";

export interface PostGISFormData {
  dbtype: 'postgis',
  host: string
  port: string
  database: string
  schema: string
  user: string
  passwd: string
}

export const DEFAULT_FORM: PostGISFormData = {
  dbtype: 'postgis',
  host: 'localhost',
  port: '5432',
  database: '',
  schema: 'public',
  user: '',
  passwd: '',
}

interface Props {
  form: PostGISFormData
  setForm: Dispatch<SetStateAction<PostGISFormData>>
  mode: PGEditorModeType
}

export default function DataStorePostGIS({ form, setForm, mode }: Props) {
  const [showPassword, setShowPassword] = useState(false)
  const set = (key: keyof PostGISFormData) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }))

  useEffect(() => {
    if (mode === PGEditorMode.EDIT) return;
    setForm(DEFAULT_FORM)
  }, [])

  return (
    <>
      <HStack align="flex-start">
        <FormControl isRequired flex={3}>
          <FormLabel>Host</FormLabel>
          <Input value={form.host} onChange={set('host')}
                 placeholder="localhost"/>
        </FormControl>
        <FormControl isRequired flex={1}>
          <FormLabel>Port</FormLabel>
          <Input value={form.port} onChange={set('port')} placeholder="5432"/>
        </FormControl>
      </HStack>

      <FormControl isRequired>
        <FormLabel>Database</FormLabel>
        <Input value={form.database} onChange={set('database')}
               placeholder="mydb"/>
      </FormControl>

      <FormControl>
        <FormLabel>Schema</FormLabel>
        <Input value={form.schema} onChange={set('schema')}
               placeholder="public"/>
      </FormControl>

      <HStack align="flex-start">
        <FormControl isRequired>
          <FormLabel>User</FormLabel>
          <Input
            value={form.user} onChange={set('user')}
            placeholder="postgres"/>
        </FormControl>
        <FormControl isRequired>
          <FormLabel>Password</FormLabel>
          <InputGroup>
            <Input
              value={form.passwd}
              onChange={set('passwd')}
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
            />
            <InputRightElement>
              <IconButton
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                icon={showPassword ? <FiEyeOff/> : <FiEye/>}
                size="sm"
                variant="ghost"
                onClick={() => setShowPassword(v => !v)}
              />
            </InputRightElement>
          </InputGroup>
        </FormControl>
      </HStack>
    </>
  )
}